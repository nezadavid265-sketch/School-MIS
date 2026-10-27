// End-to-end API tests against a throwaway demo database. Run: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server/server');
const sec = require('../server/security');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smis-test-'));
let server, base;

before(async () => {
  server = createServer({ dbFile: path.join(dir, 'test.db') });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); server.db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

// Minimal client that keeps the session cookie
function client() {
  let cookie = '';
  const call = async (p, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(base + p, { method, headers: { 'X-Requested-With': 'smis', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };
  return { call, login: async (username, password = 'demo1234', code) => call('/login', { method: 'POST', body: { username, password, code } }) };
}
const as = async (role) => { const c = client(); const r = await c.login(role); assert.equal(r.status, 200, `login ${role}`); return c.call; };

test('rejects wrong password and unauthenticated requests', async () => {
  const c = client();
  assert.equal((await c.login('director', 'wrong')).status, 401);
  assert.equal((await c.call('/dashboard')).status, 401);
});

test('state-changing requests need the same-origin header (CSRF)', async () => {
  const api = await as('bursar');
  const r = await api('/r/expenses', { method: 'POST', body: { category: 'X', description: 'y', amount: 10, spent_on: '2026-01-01' }, headers: { 'X-Requested-With': '' } });
  assert.equal(r.status, 403);
});

test('every role can load its dashboard', async () => {
  for (const role of ['director', 'headteacher', 'teacher', 'bursar', 'hr', 'admin', 'sysadmin', 'nurse', 'parent', 'student']) {
    const api = await as(role);
    assert.equal((await api('/dashboard')).status, 200, role);
    assert.equal((await api('/meta')).status, 200, role);
  }
});

test('role-based access: parents, teachers and salaries', async () => {
  const parent = await as('parent');
  const portal = await parent('/portal');
  assert.equal(portal.status, 200);
  const mine = portal.data.kids.map((k) => k.student.id);
  const other = mine.includes(5) ? 6 : 5;
  assert.equal((await parent(`/students/${other}/profile`)).status, 403);
  assert.equal((await parent(`/students/${mine[0]}/profile`)).status, 200);
  assert.equal((await parent('/r/staff')).status, 403);

  const teacher = await as('teacher');
  assert.equal((await teacher('/r/staff')).status, 403);
  assert.equal((await teacher('/finance/summary')).status, 403);
  const hr = await as('hr');
  const staff = await hr('/r/staff');
  assert.ok('salary' in staff.data.rows[0]);
  const admin = await as('admin');
  assert.ok(!('salary' in (await admin('/r/staff')).data.rows[0]), 'admin must not see salaries');
  assert.equal((await teacher('/r/health_records')).status, 403, 'health records are restricted');
});

test('payments: receipt numbers, duplicate references, no overpayment, reversal', async () => {
  const api = await as('bursar');
  const inv = (await api('/r/invoices?status=Unpaid&limit=1')).data.rows[0];
  const pay = await api('/payments', { method: 'POST', body: { invoice_id: inv.id, amount: 10000, method: 'Mobile Money', reference: 'TEST-REF-1' } });
  assert.equal(pay.status, 201);
  assert.match(pay.data.receipt_no, /^RC-\d{4}-\d{5}$/);
  assert.equal((await api('/payments', { method: 'POST', body: { invoice_id: inv.id, amount: 5000, method: 'Mobile Money', reference: 'TEST-REF-1' } })).status, 409);
  assert.equal((await api('/payments', { method: 'POST', body: { invoice_id: inv.id, amount: inv.amount * 2, method: 'Cash' } })).status, 409);
  assert.equal((await api('/payments', { method: 'POST', body: { invoice_id: inv.id, amount: 1000, method: 'Bank' } })).status, 400, 'bank needs a reference');
  assert.equal((await api(`/r/payments/${pay.data.id}`, { method: 'DELETE' })).status, 405, 'payments cannot be deleted');
  assert.equal((await api(`/payments/${pay.data.id}/reverse`, { method: 'POST', body: { reason: 'Test' } })).status, 200);
  const after_ = (await api(`/r/invoices/${inv.id}`)).data;
  assert.equal(after_.paid, inv.paid, 'reversed payment no longer counts');
});

test('finance totals come from transactions', async () => {
  const api = await as('director');
  const s = (await api('/finance/summary')).data;
  const inv = (await api(`/r/invoices?term_id=${s.term.id}&limit=5000`)).data.rows;
  assert.equal(s.billed, inv.reduce((a, b) => a + b.amount, 0));
  assert.equal(s.collected, inv.reduce((a, b) => a + b.paid, 0));
});

test('marks: validation, approval workflow and provisional report cards', async () => {
  const teacher = await as('teacher');
  const mine = (await teacher('/r/teacher_assignments?teacher_id=' + (await teacher('/me')).data.user.staff_id)).data.rows[0];
  const meta = (await teacher('/meta')).data;
  const exam = meta.assessments.find((a) => a.term_id === meta.currentTerm.id && a.name === 'Exam');
  const sheet = (await teacher(`/marks?class_id=${mine.class_id}&subject_id=${mine.subject_id}&assessment_id=${exam.id}`)).data;
  const sid = sheet.rows[0].id;
  assert.equal((await teacher('/marks', { method: 'POST', body: { class_id: mine.class_id, subject_id: mine.subject_id, assessment_id: exam.id, records: [{ student_id: sid, score: exam.max_score + 1 }] } })).status, 400);
  assert.equal((await teacher('/marks', { method: 'POST', body: { class_id: mine.class_id, subject_id: mine.subject_id, assessment_id: exam.id, records: [{ student_id: sid, score: 45 }] } })).status, 200);
  const head = await as('headteacher');
  const rc = (await head(`/reportcard?student_id=${sid}`)).data;
  assert.equal(rc.result.provisional, true);
  assert.ok((await head('/marks/pending')).data.length > 0);
  await head('/marks/approve', { method: 'POST', body: { assessment_id: exam.id, subject_id: mine.subject_id, class_id: mine.class_id } });
  assert.equal((await head(`/reportcard?student_id=${sid}`)).data.result.provisional, false);
  // A teacher cannot enter marks for a subject they do not teach
  const notMine = meta.subjects.find((s) => s.id !== mine.subject_id);
  const others = (await head(`/r/teacher_assignments?class_id=${mine.class_id}&subject_id=${notMine.id}`)).data.rows[0];
  if (others.teacher_id !== (await teacher('/me')).data.user.staff_id) {
    assert.equal((await teacher(`/marks?class_id=${mine.class_id}&subject_id=${notMine.id}&assessment_id=${exam.id}`)).status, 403);
  }
});

test('timetable detects teacher clashes', async () => {
  const api = await as('headteacher');
  const slot = (await api('/timetable?class_id=1')).data.find((s) => s.day === 'Mon' && s.period === 1);
  const r = await api('/timetable', { method: 'POST', body: { class_id: 2, day: 'Mon', period: 1, subject_id: slot.subject_id, teacher_id: slot.teacher_id } });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /Conflict/);
});

test('admissions: accept and enroll creates a student and an invoice', async () => {
  const api = await as('admin');
  const app = (await api('/r/applications?status=Accepted')).data.rows[0];
  const sub = (await api('/r/applications?status=Submitted')).data.rows[0];
  assert.equal((await api(`/admissions/${sub.id}/enroll`, { method: 'POST', body: { class_id: 1 } })).status, 409);
  const r = await api(`/admissions/${app.id}/enroll`, { method: 'POST', body: { class_id: 1, boarding: 'Day' } });
  assert.equal(r.status, 200);
  const st = (await api(`/r/students/${r.data.student_id}`)).data;
  assert.equal(st.first_name, app.first_name);
  assert.ok(r.data.invoice, 'current term invoice created');
  assert.equal((await api(`/r/applications/${app.id}`)).data.status, 'Enrolled');
});

test('promotion moves students and records history', async () => {
  const api = await as('headteacher');
  const prev = (await api('/promotion/preview?class_id=5')).data.rows;
  const [a, b] = prev;
  const r = await api('/promotion', { method: 'POST', body: { class_id: 5, to_class_id: 3, decisions: [{ student_id: a.id, action: 'Promote', average: a.average }, { student_id: b.id, action: 'Repeat', average: b.average }] } });
  assert.deepEqual([r.data.Promote, r.data.Repeat], [1, 1]);
  assert.equal((await api(`/r/students/${a.id}`)).data.class_id, 3);
  const prof = (await api(`/students/${a.id}/profile`)).data;
  assert.equal(prof.history[0].action, 'Promote');
});

test('reconciliation matches by reference and posts unmatched lines', async () => {
  const api = await as('bursar');
  const onStatement = new Set((await api('/r/statement_lines?limit=5000')).data.rows.map((l) => l.reference));
  const pay = (await api('/r/payments?method=Bank&limit=5000')).data.rows.find((p) => !p.reversed && !onStatement.has(p.reference));
  const inv = (await api('/r/invoices?status=Unpaid&limit=1')).data.rows[0];
  const r = await api('/reconcile/import', { method: 'POST', body: { source: 'Bank', rows: [
    { date: pay.paid_on, reference: pay.reference, amount: pay.amount, description: 'fees' },
    { date: '2026-10-01', reference: 'NEW-REF-99', amount: 25000, description: `Fees ${inv.adm_no}` },
    { date: '2026-10-01', reference: pay.reference, amount: pay.amount, description: 'duplicate line' },
  ] } });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.matched, r.data.unmatched, r.data.duplicate], [1, 1, 1]);
  const line = (await api(`/r/statement_lines?batch=${r.data.batch}&status=Unmatched`)).data.rows[0];
  const sug = (await api(`/reconcile/${line.id}/suggest`)).data;
  assert.equal(sug.suggestions[0].id, inv.id, 'admission number in narration suggests the invoice');
  const posted = await api(`/reconcile/${line.id}/post`, { method: 'POST', body: { invoice_id: inv.id } });
  assert.match(posted.data.receipt_no, /^RC-/);
  assert.equal((await api(`/reconcile/${line.id}/post`, { method: 'POST', body: { invoice_id: inv.id } })).status, 409);
});

test('purchase orders: approval chain creates a traceable expense', async () => {
  const bursar = await as('bursar');
  const director = await as('director');
  const created = await bursar('/r/purchase_orders', { method: 'POST', body: { supplier_id: 1, category: 'Food & Catering', description: 'Beans 500kg', amount: 600000 } });
  const id = created.data.id;
  assert.equal((await bursar(`/purchase-orders/${id}/approve`, { method: 'POST' })).status, 403, 'bursar cannot approve');
  assert.equal((await bursar(`/purchase-orders/${id}/receive`, { method: 'POST' })).status, 409, 'must be approved first');
  assert.equal((await director(`/purchase-orders/${id}/approve`, { method: 'POST' })).status, 200);
  assert.equal((await bursar(`/purchase-orders/${id}/receive`, { method: 'POST' })).status, 200);
  assert.equal((await bursar(`/purchase-orders/${id}/pay`, { method: 'POST' })).status, 200);
  const po = (await bursar(`/r/purchase_orders/${id}`)).data;
  assert.equal(po.status, 'Paid');
  const exp = (await bursar(`/r/expenses/${po.expense_id}`)).data;
  assert.equal(exp.amount, 600000);
  assert.equal(exp.status, 'Approved');
});

test('boarding and transport capacity rules', async () => {
  const api = await as('admin');
  const boy = (await api('/r/students?gender=M&boarding=Day&limit=1')).data.rows[0];
  const girlsDorm = (await api('/r/dormitories')).data.rows.find((d) => d.gender === 'F');
  const r = await api('/r/dorm_allocations', { method: 'POST', body: { student_id: boy.id, dorm_id: girlsDorm.id, bed: 'X1' } });
  assert.equal(r.status, 409);
});

test('messaging builds personalised recipient lists', async () => {
  const api = await as('bursar');
  const pv = (await api('/messages', { method: 'POST', body: { channel: 'SMS', audience: 'arrears', body: 'Dear {name}, balance {balance}', preview: true } })).data;
  assert.ok(pv.count > 0);
  assert.match(pv.sample[0].text, /RWF/);
  const sent = await api('/messages', { method: 'POST', body: { channel: 'SMS', audience: 'arrears', body: 'Dear {name}, balance {balance}' } });
  assert.equal(sent.status, 201);
  assert.equal((await api(`/messages/${sent.data.id}/recipients`)).data.length, pv.count);
});

test('documents get numbered references', async () => {
  const api = await as('admin');
  const a = await api('/documents', { method: 'POST', body: { doc_type: 'Student ID card', student_id: 1 } });
  const b = await api('/documents', { method: 'POST', body: { doc_type: 'Transfer certificate', student_id: 2 } });
  assert.match(a.data.ref_no, /^DOC-\d{4}-\d{5}$/);
  assert.notEqual(a.data.ref_no, b.data.ref_no);
  assert.equal((await api(`/documents/${b.data.id}`)).data.student.id, 2);
});

test('two-step sign-in (TOTP) for privileged accounts', async () => {
  const c = client(); await c.login('hr');
  const { secret } = (await c.call('/mfa/setup', { method: 'POST' })).data;
  assert.equal((await c.call('/mfa/enable', { method: 'POST', body: { code: '000000' } })).status, 400);
  assert.equal((await c.call('/mfa/enable', { method: 'POST', body: { code: sec.totp(secret) } })).status, 200);
  const c2 = client();
  assert.equal((await c2.login('hr')).data.mfa_required, true);
  assert.equal((await c2.login('hr', 'demo1234', '123456')).status, 401);
  assert.equal((await c2.login('hr', 'demo1234', sec.totp(secret))).status, 200);
  assert.equal((await c2.call('/me')).data.user.mfa_enabled, true);
  // System admin can reset a lost authenticator
  const admin = await as('sysadmin');
  const hrId = (await admin('/r/users?q=hr')).data.rows.find((x) => x.username === 'hr').id;
  assert.equal((await admin(`/users/${hrId}/mfa-reset`, { method: 'POST' })).status, 200);
});

test('every report runs for the director', async () => {
  const api = await as('director');
  const list = (await api('/reports')).data;
  assert.ok(list.length >= 10);
  for (const r of list) { const out = await api(`/reports/${r.key}`); assert.equal(out.status, 200, r.key); assert.ok(Array.isArray(out.data.rows), r.key); }
});

test('audit log records important actions', async () => {
  const api = await as('sysadmin');
  const rows = (await api('/r/audit_logs?limit=2000')).data.rows.map((r) => r.action);
  for (const a of ['login', 'login_failed', 'payment', 'payment_reverse', 'marks_approve', 'enroll', 'po_pay', 'mfa_enabled']) assert.ok(rows.includes(a), a);
});
