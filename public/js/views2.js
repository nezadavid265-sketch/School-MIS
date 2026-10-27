// Pages for admissions, promotion, homework, syllabus, staff reviews, payment plans, reconciliation,
// procurement, transport, boarding, health, messaging and official documents.
import { state, api, t, esc, money, num, pct, date, today, initials, can, icon, toast, modal, confirmBox, formModal, dataTable, exportRows, kpi, badge, statusTone, empty, loading, tabs, barChart, donut, meter, opt, className, currentTermId } from './core.js';
import { header, btn, card, filterBar, sel, inp, crudPage, studentOptions } from './views.js';

const go = (h) => { location.hash = h; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Mount a crudPage inside a tab body without its own big title
async function sub(page, b, p, q) { const s = document.createElement('div'); b.replaceChildren(s); await page(s, p, q); s.querySelector('.page-head h1')?.remove(); s.querySelector('.page-head p')?.remove(); }

// ============ ADMISSIONS ============
const appTone = { Submitted: 'info', Interview: 'warn', Waitlisted: 'warn', Accepted: 'good', Enrolled: 'good', Rejected: 'bad' };
export const admissions = crudPage({
  title: 'Admissions', sub: 'Applications → interview → decision → enrollment (creates the student record and first invoice)', res: 'applications', perm: 'admissions',
  filters: [{ key: 'status', label: 'Status', options: () => opt.list('Submitted', 'Interview', 'Waitlisted', 'Accepted', 'Rejected', 'Enrolled') }, { key: 'applying_for', label: 'Level', options: () => opt.list('S1', 'S2', 'S3', 'S4', 'S5', 'S6') }],
  columns: [{ key: 'app_no', label: 'App no' }, { key: 'name', label: 'Applicant', value: (r) => `${r.first_name} ${r.last_name}`, html: (r) => `<div class="who"><span class="avatar sm">${initials(r.first_name + ' ' + r.last_name)}</span><div><b>${esc(r.first_name)} ${esc(r.last_name)}</b><small>${esc(r.previous_school || '')}</small></div></div>` },
    { key: 'applying_for', label: 'Level' }, { key: 'previous_results', label: 'Previous results' }, 'guardian_name', 'guardian_phone', { key: 'interview_date', label: 'Interview', html: (r) => (r.interview_date ? date(r.interview_date) : '–') },
    { key: 'status', html: (r) => badge(r.status, appTone[r.status]) }],
  rowActions: (r) => (can('admissions', 'w') ? (r.status === 'Accepted' ? `<button class="btn primary sm" data-action="enroll" data-id="${r.id}">${icon('cap', 14)} Enroll</button>` : r.status === 'Enrolled' ? `<a class="btn ghost sm" href="#/students/${r.student_id}">Profile</a>` : `<button class="btn ghost sm" data-action="accept" data-id="${r.id}">Accept</button>`) : ''),
  editable: (r) => r.status !== 'Enrolled',
  fields: [{ name: 'first_name', label: 'First name', required: true }, { name: 'last_name', label: 'Last name', required: true }, { name: 'gender', label: 'Gender', type: 'select', options: [['F', 'Female'], ['M', 'Male']], required: true },
    { name: 'dob', label: 'Date of birth', type: 'date' }, { name: 'applying_for', label: 'Applying for', type: 'select', options: opt.list('S1', 'S2', 'S3', 'S4', 'S5', 'S6'), required: true },
    { name: 'previous_school', label: 'Previous school' }, { name: 'previous_results', label: 'Previous results', placeholder: 'e.g. 78% P6 national exam' },
    { name: 'guardian_name', label: 'Parent / guardian', required: true }, { name: 'guardian_phone', label: 'Guardian phone', type: 'tel', required: true }, { name: 'guardian_email', label: 'Guardian email', type: 'email' },
    { name: 'address', label: 'Address / district' }, { name: 'status', label: 'Status', type: 'select', options: opt.list('Submitted', 'Interview', 'Waitlisted', 'Accepted', 'Rejected'), default: 'Submitted', required: true },
    { name: 'interview_date', label: 'Interview date', type: 'date' }, { name: 'notes', label: 'Notes', type: 'textarea', full: true }],
  onRowsLoaded: (rows, body) => {
    const c = (s) => rows.filter((r) => r.status === s).length;
    body.querySelector('#extra').innerHTML = `<div class="pipeline">${[['Submitted', 'inbox'], ['Interview', 'users'], ['Waitlisted', 'calendar'], ['Accepted', 'check'], ['Enrolled', 'cap'], ['Rejected', 'x']].map(([s, ic]) => `<div class="stage ${appTone[s]}">${icon(ic, 18)}<b>${c(s)}</b><span>${s}</span></div>`).join('<i class="arrow">›</i>')}</div>`;
  },
  onAction: async (action, id, reload) => {
    if (action === 'accept') { await api(`/r/applications/${id}`, { method: 'PUT', body: { status: 'Accepted' } }); toast('Application accepted', 'success'); reload(); }
    if (action === 'enroll') formModal({ title: 'Enroll accepted applicant', submitText: 'Enroll student', fields: [{ name: 'class_id', label: 'Class', type: 'select', options: opt.classes, required: true }, { name: 'boarding', label: 'Day / Boarding', type: 'select', options: opt.list('Day', 'Boarding'), required: true }],
      onSubmit: async (d, close) => { const r = await api(`/admissions/${id}/enroll`, { method: 'POST', body: d }); close(); toast(`Enrolled as ${r.adm_no}${r.invoice ? ` · invoice ${r.invoice} created` : ''}`, 'success'); go(`#/students/${r.student_id}`); } });
  },
});

// ============ PROMOTION ============
export async function promotion(el) {
  const body = header(el, 'Promotion & graduation', { sub: 'End of year: promote, repeat or graduate each student based on approved results and the pass mark' });
  body.innerHTML = filterBar([sel('pr-class', opt.classes(), state.meta.classes[0]?.id, 'From class'), sel('pr-term', opt.terms(), currentTermId(), 'Based on results of'), sel('pr-to', opt.classes(), state.meta.classes[2]?.id, 'Promote to', { blank: '— none (graduating class) —' })]) + '<div id="pr"></div>';
  const load = async () => {
    const out = body.querySelector('#pr'); out.innerHTML = loading();
    const d = await api(`/promotion/preview?class_id=${body.querySelector('#pr-class').value}&term_id=${body.querySelector('#pr-term').value}`);
    const dec = Object.fromEntries(d.rows.map((r) => [r.id, r.suggested]));
    const summary = () => { const c = { Promote: 0, Repeat: 0, Graduate: 0 }; Object.values(dec).forEach((x) => c[x]++); return `<div class="stat-row"><div class="good"><b>${c.Promote}</b><small>Promote</small></div><div class="warn"><b>${c.Repeat}</b><small>Repeat</small></div><div class="info"><b>${c.Graduate}</b><small>Graduate</small></div><div><b>${d.pass}%</b><small>Pass mark</small></div></div>`; };
    out.innerHTML = `${card('', `<div class="roll-head"><div id="ps">${summary()}</div><div><button class="btn ghost sm" data-all="Promote">All promote</button> <button class="btn ghost sm" data-all="Graduate">All graduate</button></div></div>`)}
      <div class="table-wrap"><table class="table"><thead><tr><th class="num">Pos</th><th>Student</th><th class="num">Average</th><th>Suggested</th><th>Decision</th></tr></thead><tbody>
      ${d.rows.sort((a, b) => (a.position || 999) - (b.position || 999)).map((r) => `<tr><td class="num">${r.position || '–'}</td><td><b>${esc(r.name)}</b> <small class="muted">${esc(r.adm_no)}</small></td><td class="num">${pct(r.average)} ${meter(r.average)}</td><td>${badge(r.suggested, r.suggested === 'Promote' ? 'good' : 'warn')}</td>
        <td><div class="seg wide" data-id="${r.id}">${['Promote', 'Repeat', 'Graduate'].map((a) => `<button data-a="${a}" class="${dec[r.id] === a ? `on ${a === 'Promote' ? 'good' : a === 'Repeat' ? 'warn' : 'info'}` : ''}" ${can('promotion', 'w') ? '' : 'disabled'}>${a}</button>`).join('')}</div></td></tr>`).join('')}
      </tbody></table></div>${can('promotion', 'w') ? `<div class="sticky-save"><span class="muted small">Each decision is stored in the student's enrollment history.</span>${btn('Apply decisions', 'apply', { ic: 'up' })}</div>` : ''}`;
    const paint = (seg) => seg.querySelectorAll('button').forEach((b) => (b.className = dec[seg.dataset.id] === b.dataset.a ? `on ${b.dataset.a === 'Promote' ? 'good' : b.dataset.a === 'Repeat' ? 'warn' : 'info'}` : ''));
    out.querySelectorAll('.seg button').forEach((b) => (b.onclick = () => { dec[b.parentElement.dataset.id] = b.dataset.a; paint(b.parentElement); out.querySelector('#ps').innerHTML = summary(); }));
    out.querySelectorAll('[data-all]').forEach((b) => (b.onclick = () => { Object.keys(dec).forEach((k) => (dec[k] = b.dataset.all)); out.querySelectorAll('.seg').forEach(paint); out.querySelector('#ps').innerHTML = summary(); }));
    const ap = out.querySelector('#apply'); if (ap) ap.onclick = async () => {
      const to = body.querySelector('#pr-to').value;
      if (!(await confirmBox(`Apply ${Object.keys(dec).length} decisions for ${className(body.querySelector('#pr-class').value)}${to ? ` (promoted students move to ${className(to)})` : ''}? This changes students' classes.`))) return;
      try { const r = await api('/promotion', { method: 'POST', body: { class_id: Number(body.querySelector('#pr-class').value), to_class_id: to ? Number(to) : null, decisions: d.rows.map((x) => ({ student_id: x.id, action: dec[x.id], average: x.average })) } }); toast(`${r.Promote} promoted · ${r.Repeat} repeating · ${r.Graduate} graduated`, 'success'); load(); }
      catch (e) { toast(e.message, 'error'); }
    };
  };
  body.querySelectorAll('select').forEach((s) => (s.onchange = load));
  load();
}

// ============ HOMEWORK & SYLLABUS ============
export const homework = crudPage({
  title: 'Homework & assignments', sub: 'Set work for a class — students and parents see it in their portal', res: 'homework', perm: 'homework',
  filters: [{ key: 'class_id', label: 'Class', options: opt.myClasses }, { key: 'subject_id', label: 'Subject', options: opt.subjects }],
  columns: [{ key: 'due_on', label: 'Due', html: (r) => `${date(r.due_on)} ${r.due_on < today() ? badge('Past', '') : r.due_on <= new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) ? badge('Soon', 'warn') : ''}` }, 'class_name', 'subject_name', { key: 'title', html: (r) => `<b>${esc(r.title)}</b><small class="muted block">${esc(r.description || '')}</small>` }, { key: 'teacher', label: 'Set by' }],
  fields: [{ name: 'class_id', label: 'Class', type: 'select', options: opt.myClasses, required: true }, { name: 'subject_id', label: 'Subject', type: 'select', options: opt.subjects, required: true }, { name: 'title', label: 'Title', required: true, full: true }, { name: 'description', label: 'Instructions', type: 'textarea', full: true }, { name: 'assigned_on', label: 'Assigned', type: 'date', default: today() }, { name: 'due_on', label: 'Due date', type: 'date', required: true }],
});

export async function syllabus(el) {
  const body = header(el, 'Syllabus coverage', { sub: 'Track units taught per class and subject — head teachers see where classes are falling behind' });
  const classes = opt.myClasses();
  body.innerHTML = filterBar([sel('sy-class', classes, classes[0]?.[0], t('Class')), sel('sy-term', opt.terms(), currentTermId(), t('Term'))]) + '<div id="sy"></div>';
  const w = can('syllabus', 'w');
  const load = async () => {
    const out = body.querySelector('#sy'); out.innerHTML = loading();
    const { rows } = await api(`/r/syllabus_topics?limit=5000&class_id=${body.querySelector('#sy-class').value}&term_id=${body.querySelector('#sy-term').value}`);
    const bySub = {}; rows.forEach((r) => (bySub[r.subject_name] ||= []).push(r));
    const total = rows.length, covered = rows.filter((r) => r.status === 'Covered').length;
    out.innerHTML = `<div class="kpis">${kpi({ label: 'Overall coverage', value: pct(total ? (covered / total) * 100 : 0), sub: `${covered} of ${total} units covered`, ic: 'book' })}${kpi({ label: 'Behind (under 50%)', value: Object.values(bySub).filter((u) => u.filter((x) => x.status === 'Covered').length / u.length < 0.5).length, sub: 'subjects', ic: 'alert', tone: 'bad' })}</div>
      <div class="grid">${Object.entries(bySub).map(([s, units]) => { const c = units.filter((u) => u.status === 'Covered').length; return card(s, `<div class="cov-head"><b>${pct((c / units.length) * 100)}</b>${meter((c / units.length) * 100)}<small class="muted">${esc(units[0].teacher || '')}</small></div>
        <ul class="units">${units.map((u) => `<li><span>${esc(u.unit)}</span>${w ? `<select data-u="${u.id}" class="unit-sel ${statusTone(u.status === 'Covered' ? 'Paid' : u.status === 'In progress' ? 'Pending' : 'Unpaid')}">${['Not started', 'In progress', 'Covered'].map((x) => `<option ${x === u.status ? 'selected' : ''}>${x}</option>`).join('')}</select>` : badge(u.status, u.status === 'Covered' ? 'good' : u.status === 'In progress' ? 'warn' : '')}</li>`).join('')}</ul>${w ? `<button class="btn ghost sm" data-add="${units[0].subject_id}">${icon('plus', 14)} Add unit</button>` : ''}`); }).join('') || empty('No syllabus units for this class yet', 'book')}</div>`;
    out.querySelectorAll('[data-u]').forEach((s) => (s.onchange = async () => { await api(`/r/syllabus_topics/${s.dataset.u}`, { method: 'PUT', body: { status: s.value, covered_on: s.value === 'Covered' ? today() : null } }); toast('Syllabus updated', 'success'); load(); }));
    out.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => formModal({ title: 'Add syllabus unit', fields: [{ name: 'unit', label: 'Unit / topic', required: true, full: true }], onSubmit: async (d, close) => { await api('/r/syllabus_topics', { method: 'POST', body: { ...d, class_id: Number(body.querySelector('#sy-class').value), subject_id: Number(b.dataset.add), term_id: Number(body.querySelector('#sy-term').value) } }); close(); load(); } })));
  };
  body.querySelectorAll('select').forEach((s) => (s.onchange = load));
  load();
}

export const reviews = crudPage({
  title: 'Staff performance reviews', sub: 'Termly appraisal notes, visible to HR, the head teacher and the director', res: 'staff_reviews', perm: 'reviews',
  columns: ['period', { key: 'staff_name', html: (r) => `<b>${esc(r.staff_name)}</b><small class="muted block">${esc(r.job_title)}</small>` }, { key: 'rating', html: (r) => `<span class="stars">${'★'.repeat(r.rating || 0)}<i>${'★'.repeat(5 - (r.rating || 0))}</i></span>` }, 'strengths', 'improvements', 'reviewer'],
  fields: [{ name: 'staff_id', label: 'Staff member', type: 'select', options: opt.staff, required: true, full: true }, { name: 'period', label: 'Period', required: true, default: `${new Date().getFullYear()} ${state.meta?.currentTerm?.name || ''}` }, { name: 'rating', label: 'Rating (1–5)', type: 'number', min: 1, max: 5, required: true }, { name: 'strengths', label: 'Strengths', type: 'textarea', full: true }, { name: 'improvements', label: 'Areas to improve', type: 'textarea', full: true }],
});

// ============ PAYMENT PLANS ============
export async function plans(el) {
  const w = can('finance', 'w');
  const body = header(el, 'Payment plans', { sub: 'Agree instalments with families — the system tracks each due date against real payments', actions: w ? btn('New instalment', 'add', { ic: 'plus' }) : '' });
  const load = async () => {
    body.innerHTML = loading();
    const { rows } = await api('/r/payment_plans?limit=5000');
    const state_ = (r) => (r.paid_to_date >= r.cumulative_due ? 'Paid' : r.due_on < today() ? 'Overdue' : 'Upcoming');
    rows.forEach((r) => (r.state = state_(r)));
    const overdue = rows.filter((r) => r.state === 'Overdue');
    body.innerHTML = `<div class="kpis">${kpi({ label: 'Families on a plan', value: new Set(rows.map((r) => r.invoice_id)).size, ic: 'users' })}${kpi({ label: 'Overdue instalments', value: overdue.length, sub: money(overdue.reduce((a, r) => a + Math.min(r.amount, r.cumulative_due - r.paid_to_date), 0)), ic: 'alert', tone: 'bad' })}${kpi({ label: 'Due in next 30 days', value: rows.filter((r) => r.state === 'Upcoming' && r.due_on <= new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)).length, ic: 'calendar', tone: 't2' })}</div>
      ${overdue.length && can('messaging', 'w') ? `<div class="alerts"><a class="alert warn" href="#/messages?audience=arrears">${icon('mail', 18)}<span>Send a reminder SMS to families with outstanding balances</span><b>›</b></a></div>` : ''}<div id="pt"></div>`;
    dataTable(body.querySelector('#pt'), { rows, exportName: 'payment-plans', columns: [{ key: 'due_on', label: 'Due', html: (r) => date(r.due_on) }, 'student_name', 'adm_no', 'invoice_no', 'note', { key: 'amount', num: true, html: (r) => money(r.amount) }, { key: 'paid_to_date', label: 'Paid to date', num: true, html: (r) => money(r.paid_to_date) }, { key: 'state', label: 'Status', html: (r) => badge(r.state, r.state === 'Paid' ? 'good' : r.state === 'Overdue' ? 'bad' : 'info') }, 'guardian_phone'] });
  };
  const a = el.querySelector('#add');
  if (a) a.onclick = async () => {
    const inv = (await api(`/r/invoices?limit=5000&term_id=${currentTermId()}`)).rows.filter((i) => i.balance > 0);
    formModal({ title: 'Add instalment', fields: [{ name: 'invoice_id', label: 'Invoice (balance)', type: 'select', required: true, full: true, options: inv.map((i) => [i.id, `${i.student_name} · ${i.invoice_no} · balance ${money(i.balance)}`]) }, { name: 'due_on', label: 'Due date', type: 'date', required: true }, { name: 'amount', label: 'Amount (RWF)', type: 'number', min: 1, required: true }, { name: 'note', label: 'Note', placeholder: 'Instalment 1' }],
      onSubmit: async (d, close) => { await api('/r/payment_plans', { method: 'POST', body: d }); toast('Instalment added', 'success'); close(); load(); } });
  };
  load();
}

// ============ RECONCILIATION ============
function parseStatement(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const split = (l) => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if ((ch === ',' || ch === ';' || ch === '\t') && !q) { out.push(cur.trim()); cur = ''; } else cur += ch; } out.push(cur.trim()); return out; };
  const head = split(lines[0]).map((h) => h.toLowerCase());
  const hasHead = head.some((h) => /date|ref|amount|desc|narr|details/.test(h));
  const idx = (re, d) => { const i = head.findIndex((h) => re.test(h)); return hasHead && i >= 0 ? i : d; };
  const iD = idx(/date/, 0), iR = idx(/ref|transaction|txn|id/, 1), iDesc = idx(/desc|narr|details|memo/, 2), iA = idx(/amount|credit|paid/, 3);
  return lines.slice(hasHead ? 1 : 0).map(split).map((c) => ({ date: c[iD], reference: c[iR], description: c[iDesc], amount: Number(String(c[iA] || '').replace(/[^\d.-]/g, '')) })).filter((r) => r.amount > 0);
}
export async function reconcile(el) {
  const w = can('finance', 'w');
  const body = header(el, 'Bank & Mobile Money reconciliation', { sub: 'Import a statement, match it to recorded payments, and post money that was received but never receipted' });
  body.innerHTML = `${w ? card('Import a statement', `<div class="form-grid"><label class="field"><span>Source</span><select id="rc-src"><option>Bank</option><option>Mobile Money</option></select></label><label class="field"><span>Statement file (CSV)</span><input type="file" id="rc-file" accept=".csv,.txt"></label>
      <label class="field full"><span>…or paste rows: date, reference, description, amount</span><textarea id="rc-text" rows="4" placeholder="2026-10-20, MM558812, Fees 2026-0014, 50000"></textarea></label></div><div class="row-end"><span class="muted small" id="rc-count"></span>${btn('Import & match', 'rc-go', { ic: 'sync' })}</div>`) : ''}
    <div id="rc-sum"></div>${filterBar([sel('rc-status', opt.list('Unmatched', 'Amount mismatch', 'Matched', 'Ignored'), 'Unmatched', 'Show', { blank: 'All lines' })])}<div id="rc-tbl"></div>`;
  const load = async () => {
    const [{ rows }, rep] = await Promise.all([api(`/r/statement_lines?limit=5000&status=${encodeURIComponent(body.querySelector('#rc-status').value)}`), api('/reports/reconciliation')]);
    const tot = rep.rows.reduce((a, r) => ({ lines: a.lines + r.lines, matched: a.matched + r.matched, mismatch: a.mismatch + r.mismatch, unmatched: a.unmatched + r.unmatched }), { lines: 0, matched: 0, mismatch: 0, unmatched: 0 });
    body.querySelector('#rc-sum').innerHTML = `<div class="kpis">${kpi({ label: 'Statement lines', value: num(tot.lines), sub: `${rep.rows.length} import(s)`, ic: 'bank' })}${kpi({ label: 'Matched to receipts', value: num(tot.matched), sub: pct(tot.lines ? (tot.matched / tot.lines) * 100 : 0), ic: 'check', tone: 't3' })}${kpi({ label: 'Need attention', value: num(tot.unmatched + tot.mismatch), sub: `${tot.mismatch} amount mismatch(es)`, ic: 'alert', tone: tot.unmatched + tot.mismatch ? 'bad' : 't2' })}</div>`;
    dataTable(body.querySelector('#rc-tbl'), { rows, exportName: 'statement-lines', empty: 'Nothing here — all clear ✓', columns: [{ key: 'line_date', label: 'Date', html: (r) => date(r.line_date) }, 'source', 'reference', 'description', { key: 'amount', num: true, html: (r) => money(r.amount) }, { key: 'status', html: (r) => badge(r.status, r.status === 'Matched' ? 'good' : r.status === 'Ignored' ? '' : 'bad') }, { key: 'receipt_no', label: 'Receipt', html: (r) => (r.payment_id ? `<a href="#/receipt/${r.payment_id}">${esc(r.receipt_no)}</a>` : '') },
      { key: 'x', label: '', html: (r) => (w && ['Unmatched', 'Amount mismatch'].includes(r.status) ? `${r.status === 'Unmatched' ? `<button class="btn primary sm" data-post="${r.id}">Post to invoice</button> ` : ''}<button class="btn ghost sm" data-ign="${r.id}">Ignore</button>` : '') }] });
  };
  body.querySelector('#rc-status').onchange = load;
  body.querySelector('#rc-tbl').addEventListener('click', async (e) => {
    const p = e.target.closest('[data-post]'), ig = e.target.closest('[data-ign]');
    if (ig) { const reason = await confirmBox('Mark this line as not school-fee income (e.g. bank charges, donations)?', { input: 'Reason' }); if (!reason) return; await api(`/reconcile/${ig.dataset.ign}/ignore`, { method: 'POST', body: { reason } }); load(); }
    if (p) {
      const s = await api(`/reconcile/${p.dataset.post}/suggest`);
      const all = s.suggestions.length ? s.suggestions : (await api(`/r/invoices?limit=5000&term_id=${currentTermId()}`)).rows.filter((i) => i.balance > 0);
      formModal({ title: `Post ${money(s.line.amount)} · ${s.line.reference || ''}`, submitText: 'Create receipt', fields: [{ name: 'info', label: 'Narration', readonly: true, full: true, default: s.line.description }, { name: 'invoice_id', label: s.suggestions.length ? 'Suggested invoice (admission number found in narration)' : 'Invoice', type: 'select', required: true, full: true, options: all.map((i) => [i.id, `${i.student_name} (${i.adm_no}) · ${i.invoice_no} · balance ${money(i.balance)}`]) }],
        onSubmit: async (d, close) => { const r = await api(`/reconcile/${p.dataset.post}/post`, { method: 'POST', body: d }); close(); toast(`Receipt ${r.receipt_no} created`, 'success'); load(); } });
    }
  });
  if (w) {
    const txt = body.querySelector('#rc-text');
    const count = () => { body.querySelector('#rc-count').textContent = `${parseStatement(txt.value).length} line(s) ready`; };
    txt.oninput = count;
    body.querySelector('#rc-file').onchange = (e) => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { txt.value = rd.result; count(); }; rd.readAsText(f); };
    body.querySelector('#rc-go').onclick = async () => {
      const rows = parseStatement(txt.value);
      if (!rows.length) return toast('No rows with an amount were found', 'error');
      try { const r = await api('/reconcile/import', { method: 'POST', body: { source: body.querySelector('#rc-src').value, rows } }); toast(`${r.matched} matched · ${r.mismatch} mismatched · ${r.unmatched} unmatched · ${r.duplicate} already imported`, 'success'); txt.value = ''; count(); body.querySelector('#rc-status').value = ''; load(); }
      catch (e) { toast(e.message, 'error'); }
    };
  }
  load();
}

// ============ PROCUREMENT ============
const poTone = { Draft: 'info', Approved: 'warn', Received: 'warn', Paid: 'good', Cancelled: 'bad' };
const suppliersPage = crudPage({ title: 'Suppliers', res: 'suppliers', perm: 'procurement', columns: ['name', 'category', 'contact', 'phone', 'email', { key: 'tin', label: 'TIN' }, { key: 'total_ordered', label: 'Ordered', num: true, html: (r) => money(r.total_ordered) }],
  fields: [{ name: 'name', label: 'Supplier name', required: true }, { name: 'category', label: 'Category', list: ['Food & Catering', 'Stationery', 'Maintenance', 'Science', 'ICT', 'Furniture', 'Transport'] }, { name: 'contact', label: 'Contact person' }, { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' }, { name: 'tin', label: 'TIN (RRA)' }] });
const ordersPage = crudPage({ title: 'Purchase orders', res: 'purchase_orders', perm: 'procurement', filters: [{ key: 'status', label: 'Status', options: () => opt.list('Draft', 'Approved', 'Received', 'Paid', 'Cancelled') }], editable: (r) => r.status === 'Draft',
  columns: ['po_no', { key: 'ordered_on', label: 'Date', html: (r) => date(r.ordered_on) }, 'supplier_name', 'category', 'description', { key: 'amount', num: true, html: (r) => money(r.amount) }, { key: 'status', html: (r) => badge(r.status, poTone[r.status]) }],
  rowActions: (r) => [r.status === 'Draft' && can('approve_po', 'w') && `<button class="btn primary sm" data-action="approve" data-id="${r.id}">Approve</button>`, r.status === 'Approved' && can('procurement', 'w') && `<button class="btn ghost sm" data-action="receive" data-id="${r.id}">Mark received</button>`, r.status === 'Received' && can('finance', 'w') && `<button class="btn primary sm" data-action="pay" data-id="${r.id}">Pay</button>`, ['Draft', 'Approved'].includes(r.status) && can('procurement', 'w') && `<button class="btn ghost sm" data-action="cancel" data-id="${r.id}">Cancel</button>`].filter(Boolean).join(' '),
  fields: async () => [{ name: 'supplier_id', label: 'Supplier', type: 'select', required: true, options: (await api('/r/suppliers?limit=1000')).rows.map((s) => [s.id, s.name]) }, { name: 'category', label: 'Expense category', required: true, list: state.meta.expenseCategories }, { name: 'description', label: 'What is being bought', required: true, full: true }, { name: 'amount', label: 'Amount (RWF)', type: 'number', min: 1, required: true }, { name: 'ordered_on', label: 'Order date', type: 'date', default: today() }],
  onAction: async (action, id, reload) => { if (!['approve', 'receive', 'pay', 'cancel'].includes(action)) return; if (action === 'pay' && !(await confirmBox('Paying records an approved expense in the books for this order.', { okText: 'Pay supplier' }))) return; try { await api(`/purchase-orders/${id}/${action}`, { method: 'POST' }); toast(`Order ${action === 'pay' ? 'paid — expense recorded' : action + 'd'}`, 'success'); reload(); } catch (e) { toast(e.message, 'error'); } },
});
export async function procurement(el, p, q) {
  const body = header(el, 'Procurement', { sub: 'Suppliers and purchase orders: Draft → director approval → received → paid (posted as an expense automatically)' });
  body.innerHTML = '<div id="t"></div><div id="b"></div>';
  const show = (tab) => sub(tab === 'orders' ? ordersPage : suppliersPage, body.querySelector('#b'), p, q);
  tabs(body.querySelector('#t'), [['orders', 'Purchase orders'], ['suppliers', 'Suppliers']], q.tab || 'orders', show); show(q.tab || 'orders');
}

// ============ TRANSPORT ============
const routesPage = crudPage({ title: 'Routes', res: 'transport_routes', perm: 'transport', columns: ['name', 'stops', { key: 'morning_time', label: 'Pick-up' }, 'plate', 'driver', { key: 'riders', num: true, html: (r) => `${r.riders}${r.seats ? ` / ${r.seats}` : ''} ${r.seats ? meter((r.riders / r.seats) * 100, { tone: r.riders >= r.seats ? 'bad' : 'good' }) : ''}` }, { key: 'fee', label: 'Term fee', num: true, html: (r) => money(r.fee) }],
  fields: async () => [{ name: 'name', label: 'Route name', required: true }, { name: 'vehicle_id', label: 'Vehicle', type: 'select', options: (await api('/r/vehicles')).rows.map((v) => [v.id, `${v.plate} · ${v.seats} seats`]) }, { name: 'driver_id', label: 'Driver', type: 'select', options: opt.staff }, { name: 'morning_time', label: 'Morning pick-up', type: 'time' }, { name: 'fee', label: 'Term fee (RWF)', type: 'number', min: 0 }, { name: 'stops', label: 'Stops (in order)', type: 'textarea', full: true }] });
const ridersPage = crudPage({ title: 'Riders', res: 'student_transport', perm: 'transport', columns: ['route_name', 'student_name', 'adm_no', 'class_name', 'stop', 'guardian_phone'], rowActions: (r) => (can('transport', 'w') ? `<button class="btn ghost sm" data-action="delete" data-id="${r.id}">Remove</button>` : ''),
  fields: async () => [{ name: 'student_id', label: 'Student', type: 'select', required: true, full: true, options: await studentOptions() }, { name: 'route_id', label: 'Route', type: 'select', required: true, options: (await api('/r/transport_routes')).rows.map((r) => [r.id, r.name]) }, { name: 'stop', label: 'Stop' }] });
const vehiclesPage = crudPage({ title: 'Vehicles', res: 'vehicles', perm: 'transport', columns: ['plate', 'model', { key: 'seats', num: true }, { key: 'insurance_until', label: 'Insurance until', html: (r) => `${date(r.insurance_until)} ${r.insurance_until <= new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) ? badge('Renew', 'bad') : ''}` }, { key: 'inspection_until', label: 'Inspection until', html: (r) => `${date(r.inspection_until)} ${r.inspection_until <= new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) ? badge('Due', 'warn') : ''}` }],
  fields: [{ name: 'plate', label: 'Plate number', required: true }, { name: 'model', label: 'Model' }, { name: 'seats', label: 'Seats', type: 'number', min: 1 }, { name: 'insurance_until', label: 'Insurance until', type: 'date' }, { name: 'inspection_until', label: 'Technical inspection until', type: 'date' }] });
export async function transport(el, p, q) {
  const body = header(el, 'Transport', { sub: 'School buses, routes, drivers and the students who ride them' });
  body.innerHTML = '<div id="t"></div><div id="b"></div>';
  const pages = { routes: routesPage, riders: ridersPage, vehicles: vehiclesPage };
  const show = (tab) => sub(pages[tab], body.querySelector('#b'), p, q);
  tabs(body.querySelector('#t'), [['routes', 'Routes'], ['riders', 'Riders'], ['vehicles', 'Vehicles']], q.tab || 'routes', show); show(q.tab || 'routes');
}

// ============ BOARDING ============
const allocPage = crudPage({ title: 'Bed allocations', res: 'dorm_allocations', perm: 'boarding', filters: [{ key: 'dorm_id', label: 'Dormitory', options: () => (window.__dorms || []).map((d) => [d.id, d.name]) }],
  columns: ['dorm_name', 'bed', 'student_name', 'adm_no', 'class_name', { key: 'allocated_on', label: 'Since', html: (r) => date(r.allocated_on) }], rowActions: (r) => (can('boarding', 'w') ? `<button class="btn ghost sm" data-action="delete" data-id="${r.id}">Check out</button>` : ''),
  fields: async () => [{ name: 'student_id', label: 'Student', type: 'select', required: true, full: true, options: (await api('/r/students?status=Active&boarding=Boarding&limit=5000')).rows.map((s) => [s.id, `${s.first_name} ${s.last_name} (${s.adm_no}) · ${s.gender}`]) }, { name: 'dorm_id', label: 'Dormitory', type: 'select', required: true, options: (window.__dorms || []).map((d) => [d.id, `${d.name} (${d.capacity - d.occupied} free)`]) }, { name: 'bed', label: 'Bed', required: true }] });
export async function boarding(el, p, q) {
  const w = can('boarding', 'w');
  const body = header(el, 'Boarding', { sub: 'Dormitories, bed allocation and capacity', actions: w ? btn('Add dormitory', 'adddorm', { ic: 'plus', kind: 'ghost' }) : '' });
  const load = async () => {
    const { rows } = await api('/r/dormitories'); window.__dorms = rows;
    body.innerHTML = `<div class="dorms">${rows.map((d) => `<article class="card dorm"><div class="dorm-ic ${d.gender === 'F' ? 'f' : 'm'}">${icon('bed', 26)}</div><div><h3>${esc(d.name)}</h3><p class="muted small">${d.gender === 'F' ? 'Girls' : d.gender === 'M' ? 'Boys' : 'Mixed'} · patron ${esc(d.patron || '—')}</p><b>${d.occupied} / ${d.capacity}</b> beds ${meter((d.occupied / d.capacity) * 100, { tone: d.occupied >= d.capacity ? 'bad' : d.occupied / d.capacity > 0.9 ? 'warn' : 'good' })}</div></article>`).join('')}</div><div id="al"></div>`;
    await sub(allocPage, body.querySelector('#al'), p, q);
  };
  const a = el.querySelector('#adddorm'); if (a) a.onclick = () => formModal({ title: 'Add dormitory', fields: [{ name: 'name', label: 'Name', required: true }, { name: 'gender', label: 'For', type: 'select', options: [['F', 'Girls'], ['M', 'Boys']] }, { name: 'capacity', label: 'Beds', type: 'number', min: 1, required: true }, { name: 'patron_id', label: 'Patron / matron', type: 'select', options: opt.staff }], onSubmit: async (d, close) => { await api('/r/dormitories', { method: 'POST', body: d }); close(); load(); } });
  load();
}

// ============ HEALTH ============
export const health = crudPage({
  title: 'Health & welfare', sub: 'Clinic visits, allergies, conditions and vaccinations', res: 'health_records', perm: 'health',
  banner: `<div class="alert info">${icon('shield', 18)}<span>Confidential medical information — visible only to the school nurse and head teacher. Every view and change is logged.</span></div>`,
  filters: [{ key: 'record_type', label: 'Type', options: () => opt.list('Clinic visit', 'Allergy', 'Chronic condition', 'Vaccination', 'Referral') }],
  columns: [{ key: 'date', html: (r) => date(r.date) }, { key: 'student_name', label: 'Student', html: (r) => `<a href="#/students/${r.student_id}">${esc(r.student_name)}</a><small class="muted block">${esc(r.class_name || '')}</small>` }, { key: 'record_type', label: 'Type', html: (r) => badge(r.record_type, r.record_type === 'Allergy' || r.record_type === 'Chronic condition' ? 'bad' : 'info') }, 'details', 'action_taken', { key: 'guardian_informed', label: 'Guardian told', html: (r) => (r.guardian_informed ? badge('Yes', 'good') : badge('No', 'warn')) }],
  fields: async () => [{ name: 'student_id', label: 'Student', type: 'select', required: true, full: true, options: await studentOptions() }, { name: 'date', label: 'Date', type: 'date', default: today(), required: true }, { name: 'record_type', label: 'Type', type: 'select', options: opt.list('Clinic visit', 'Allergy', 'Chronic condition', 'Vaccination', 'Referral'), required: true }, { name: 'details', label: 'Details / symptoms', type: 'textarea', required: true, full: true }, { name: 'action_taken', label: 'Action taken', type: 'textarea', full: true }, { name: 'guardian_informed', label: 'Guardian informed', type: 'checkbox' }],
});

// ============ MESSAGING ============
export async function messages(el, _p, query) {
  const w = can('messaging', 'w');
  const body = header(el, 'SMS & email', { sub: 'Send notices to guardians or staff. Use {name} and {balance} to personalise each message.' });
  body.innerHTML = `<div class="grid msg-layout">${w ? `<section class="card span2"><header class="card-head"><h3>New message</h3></header><div class="card-body"><form class="form-grid" id="mf">
      <label class="field"><span>Channel</span><select name="channel"><option>SMS</option><option>Email</option></select></label>
      <label class="field"><span>Send to</span><select name="audience"><option value="all">All guardians</option><option value="class">Guardians of one class</option><option value="absentees">Guardians of repeatedly absent students</option><option value="arrears">Guardians with fee balances</option><option value="staff">All staff</option></select></label>
      <label class="field" id="mf-class" hidden><span>Class</span><select name="class_id">${opt.classes().map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>
      <label class="field full" id="mf-subj" hidden><span>Email subject</span><input name="subject"></label>
      <label class="field full"><span>Message <small class="muted" id="mf-len"></small></span><textarea name="body" rows="4" required placeholder="Dear {name}, …"></textarea></label>
      <div class="full chips">${['Dear {name}, ', 'outstanding balance of {balance}', 'Parents\' meeting on Saturday at 9:00. ', '— School office'].map((s) => `<button type="button" class="chip-btn" data-ins="${esc(s)}">+ ${esc(s.trim())}</button>`).join('')}</div>
      <div class="full row-end"><span class="muted small" id="mf-count"></span>${btn('Send', 'mf-send', { ic: 'mail' })}</div></form></div></section>
      <section class="card"><header class="card-head"><h3>Preview</h3></header><div class="card-body"><div class="phone"><div class="phone-screen" id="mf-prev"><p class="muted small">Start typing to preview…</p></div></div></div></section>` : ''}</div>
    <h3 class="section-title">Sent & queued</h3><div id="mh"></div>`;
  const loadHist = async () => {
    const { rows } = await api('/r/messages?limit=500');
    dataTable(body.querySelector('#mh'), { rows, exportName: 'messages', columns: [{ key: 'created_at', label: 'When', html: (r) => date(r.created_at) }, { key: 'channel', html: (r) => badge(r.channel, 'info') }, 'audience', { key: 'body', html: (r) => esc(r.body.slice(0, 90)) }, { key: 'recipients', num: true }, { key: 'status', html: (r) => badge(r.status, r.status === 'Sent' ? 'good' : r.status === 'Failed' ? 'bad' : 'warn') }, 'sender', { key: 'x', label: '', html: (r) => `<button class="btn ghost sm" data-rcp="${r.id}">${icon('download', 14)} Recipients</button>` }] });
    body.querySelectorAll('[data-rcp]').forEach((b) => (b.onclick = async () => { const rows2 = await api(`/messages/${b.dataset.rcp}/recipients`); exportRows(`message-${b.dataset.rcp}-recipients`, ['name', 'address', 'status'], rows2, 'csv'); }));
  };
  if (w) {
    const f = body.querySelector('#mf');
    if (query.audience) f.elements.audience.value = query.audience;
    let timer;
    const preview = () => {
      f.querySelector('#mf-class').hidden = f.elements.audience.value !== 'class';
      f.querySelector('#mf-subj').hidden = f.elements.channel.value !== 'Email';
      const len = f.elements.body.value.length; f.querySelector('#mf-len').textContent = f.elements.channel.value === 'SMS' ? `${len} chars · ${Math.max(1, Math.ceil(len / 160))} SMS each` : '';
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const d = await api('/messages', { method: 'POST', body: { ...Object.fromEntries(new FormData(f)), preview: true } }).catch(() => null);
        if (!d) return;
        f.querySelector('#mf-count').textContent = `${d.audience}: ${num(d.count)} recipient(s)`;
        body.querySelector('#mf-prev').innerHTML = d.sample.length && f.elements.body.value ? d.sample.map((s) => `<div class="bubble"><small>${esc(s.to)}</small>${esc(s.text)}</div>`).join('') : '<p class="muted small">Start typing to preview…</p>';
      }, 350);
    };
    f.addEventListener('input', preview); f.addEventListener('change', preview);
    f.querySelectorAll('[data-ins]').forEach((b) => (b.onclick = () => { const ta = f.elements.body; ta.value += b.dataset.ins; ta.focus(); preview(); }));
    f.onsubmit = (e) => e.preventDefault();
    body.querySelector('#mf-send').onclick = async () => {
      if (!f.elements.body.value.trim()) return toast('Write the message first', 'error');
      if (!(await confirmBox(`${f.querySelector('#mf-count').textContent || 'Send this message'}?`, { okText: 'Send' }))) return;
      try { const r = await api('/messages', { method: 'POST', body: Object.fromEntries(new FormData(f)) }); toast(r.note ? `Saved for ${r.recipients} recipients. ${r.note}` : `Sending to ${r.recipients} recipients`, r.note ? 'info' : 'success'); f.reset(); preview(); loadHist(); }
      catch (e) { toast(e.message, 'error'); }
    };
    preview();
  }
  loadHist();
}

// ============ DOCUMENTS ============
const DOC_TYPES = ['Student ID card', 'Admission letter', 'Fee statement', 'Transfer certificate', 'Leaving certificate', 'Certificate of good conduct', 'Staff ID card', 'Employment letter'];
export async function documents(el) {
  const body = header(el, 'Documents & certificates', { sub: 'Issue official, numbered documents — each one is recorded in the register', actions: can('documents', 'w') ? btn('Issue document', 'iss', { ic: 'doc' }) : '' });
  body.innerHTML = `<div class="doc-types">${DOC_TYPES.filter((d) => !/Staff|Employment/.test(d) || can('staff')).map((d) => `<button class="quick-btn" data-type="${esc(d)}">${icon(/ID/.test(d) ? 'idcard' : /Fee/.test(d) ? 'money' : /certificate/i.test(d) ? 'star' : 'doc', 22)}<span>${esc(d)}</span></button>`).join('')}</div><h3 class="section-title">Register</h3><div id="dr"></div>`;
  const issue = async (type) => {
    const staffDoc = /Staff|Employment/.test(type || '');
    formModal({ title: 'Issue document', submitText: 'Issue & open', fields: [{ name: 'doc_type', label: 'Document', type: 'select', options: DOC_TYPES.map((x) => [x, x]), required: true, default: type }, staffDoc ? { name: 'staff_id', label: 'Staff member', type: 'select', options: opt.staff, required: true, full: true } : { name: 'student_id', label: 'Student', type: 'select', options: await studentOptions(), required: true, full: true }, { name: 'notes', label: 'Notes / reason (printed on transfer & leaving certificates)', type: 'textarea', full: true }],
      onSubmit: async (d, close) => { const r = await api('/documents', { method: 'POST', body: d }); close(); toast(`Issued ${r.ref_no}`, 'success'); go(`#/document/${r.id}`); } });
  };
  body.querySelectorAll('[data-type]').forEach((b) => (b.onclick = () => issue(b.dataset.type)));
  const i = el.querySelector('#iss'); if (i) i.onclick = () => issue();
  const { rows } = await api('/r/documents?limit=2000');
  dataTable(body.querySelector('#dr'), { rows, exportName: 'document-register', onRow: (r) => go(`#/document/${r.id}`), columns: ['ref_no', 'doc_type', 'person', { key: 'issued_at', label: 'Issued', html: (r) => date(r.issued_at) }, 'issued_by_name'] });
}

export async function documentView(el, { id }) {
  const body = header(el, 'Document', { back: '#/documents', actions: btn(t('Print') + ' / PDF', 'print', { ic: 'print' }) });
  const d = await api(`/documents/${id}`);
  const s = d.student, st = d.staff, sch = d.school, doc = d.doc;
  el.querySelector('h1').textContent = `${doc.doc_type} · ${doc.ref_no}`;
  const headHtml = `<header class="paper-head"><div class="crest">${icon('cap', 30)}</div><div><h2>${esc(sch.school_name)}</h2><p>${esc(sch.address)} · ${esc(sch.phone)}</p><p class="motto">${esc(sch.motto)}</p></div><div class="doc-title">${esc(doc.doc_type.toUpperCase())}<small>Ref. ${esc(doc.ref_no)} · ${date(doc.issued_at)}</small></div></header>`;
  const sign = `<div class="sign"><div><span></span>${esc(doc.issued_by_name || '')}</div><div><span></span>Head teacher</div><div><span></span>School stamp</div></div><footer class="paper-foot">Verify this document with the school office using reference ${esc(doc.ref_no)}.</footer>`;
  const fullName = s ? `${s.first_name} ${s.last_name}` : st ? `${st.first_name} ${st.last_name}` : '';
  const he = s && s.gender === 'F' ? 'she' : 'he', his = s && s.gender === 'F' ? 'her' : 'his';
  let html;
  if (/ID card/.test(doc.doc_type)) {
    html = `<div class="id-cards"><article class="id-card"><div class="id-top">${icon('cap', 22)}<div><b>${esc(sch.school_name)}</b><small>${s ? 'STUDENT IDENTITY CARD' : 'STAFF IDENTITY CARD'}</small></div></div>
      <div class="id-body"><div class="id-photo">${initials(fullName)}</div><div class="id-info"><h3>${esc(fullName)}</h3>${s ? `<p><span>Adm. no</span>${esc(s.adm_no)}</p><p><span>Class</span>${esc(s.class_name)}</p><p><span>Born</span>${date(s.dob)}</p><p><span>Guardian</span>${esc(s.guardian_phone || '')}</p>` : `<p><span>Staff no</span>${esc(st.staff_no)}</p><p><span>Role</span>${esc(st.job_title)}</p><p><span>Dept</span>${esc(st.department)}</p>`}</div></div>
      <div class="id-foot"><span>Valid ${esc(d.year || '')}</span><span class="barcode">${esc(s ? s.adm_no : st.staff_no).split('').map((c) => `<i style="width:${(c.charCodeAt(0) % 3) + 1}px"></i>`).join('')}</span><span>${esc(doc.ref_no)}</span></div></article></div>`;
  } else if (doc.doc_type === 'Fee statement') {
    const billed = d.invoices.reduce((a, b) => a + b.amount, 0), paid = d.invoices.reduce((a, b) => a + b.paid, 0);
    html = `<article class="paper">${headHtml}<div class="paper-meta"><div><span>Student</span><b>${esc(fullName)}</b></div><div><span>Adm. no</span><b>${esc(s.adm_no)}</b></div><div><span>Class</span><b>${esc(s.class_name)}</b></div></div>
      <table class="table paper-table"><thead><tr><th>Date</th><th>Description</th><th class="num">Charged</th><th class="num">Paid</th></tr></thead><tbody>
      ${[...d.invoices.map((i) => ({ dt: i.issued_on, desc: `${i.term_name} fees · ${i.invoice_no}`, ch: i.amount })), ...d.payments.filter((p) => !p.reversed).map((p) => ({ dt: p.paid_on, desc: `Payment ${p.receipt_no} · ${p.method}`, pd: p.amount }))].sort((a, b) => String(a.dt).localeCompare(String(b.dt))).map((x) => `<tr><td>${date(x.dt)}</td><td>${esc(x.desc)}</td><td class="num">${x.ch ? money(x.ch) : ''}</td><td class="num">${x.pd ? money(x.pd) : ''}</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="2"><b>Balance due</b></td><td class="num"><b>${money(billed)}</b></td><td class="num"><b>${money(paid)}</b></td></tr><tr><td colspan="3"><b>Outstanding</b></td><td class="num"><b>${money(billed - paid)}</b></td></tr></tfoot></table>${sign}</article>`;
  } else {
    const letters = {
      'Admission letter': `<p>Dear ${esc(s?.guardian_name || 'Parent/Guardian')},</p><p>We are pleased to confirm that <b>${esc(fullName)}</b> has been admitted to <b>${esc(s?.class_name)}</b> at ${esc(sch.school_name)} for the ${esc(d.year)} academic year, under admission number <b>${esc(s?.adm_no)}</b>, as a <b>${esc((s?.boarding || 'day').toLowerCase())}</b> student.</p><p>Please present this letter, the student's birth certificate, previous report card and proof of payment of first-term fees on reporting day. Fees may be paid at the bursar's office, by bank or by Mobile Money using the admission number as reference.</p><p>We look forward to welcoming ${his === 'her' ? 'her' : 'him'} to our school community.</p>`,
      'Transfer certificate': `<p>This is to certify that <b>${esc(fullName)}</b>, admission number <b>${esc(s?.adm_no)}</b>, born on ${date(s?.dob)}, was a student of this school from ${date(s?.enrolled_on)} and was last enrolled in <b>${esc(s?.class_name)}</b>.</p><p>${esc(he[0].toUpperCase() + he.slice(1))} is transferring to another school. ${d.attendance ? `${esc(his[0].toUpperCase() + his.slice(1))} attendance record is ${pct(d.attendance.rate)}.` : ''} ${doc.notes ? `<br>Reason: ${esc(doc.notes)}` : ''}</p><p>We have no objection to ${his === 'her' ? 'her' : 'his'} admission elsewhere and wish ${his === 'her' ? 'her' : 'him'} success.</p>`,
      'Leaving certificate': `<p>This is to certify that <b>${esc(fullName)}</b>, admission number <b>${esc(s?.adm_no)}</b>, studied at ${esc(sch.school_name)} from ${date(s?.enrolled_on)} and completed ${his} studies in <b>${esc(s?.class_name)}</b>.</p>${d.history?.length ? `<p>Progression: ${d.history.map((h) => `${esc(h.year_name || '')} ${esc(h.action)}${h.to_class ? ' → ' + esc(h.to_class) : ''}`).join(' · ')}</p>` : ''}<p>${doc.notes ? esc(doc.notes) : 'Conduct throughout: satisfactory.'}</p>`,
      'Certificate of good conduct': `<p>This is to certify that <b>${esc(fullName)}</b> (${esc(s?.adm_no)}), a student in <b>${esc(s?.class_name)}</b>, has shown good conduct and respect for the rules of ${esc(sch.school_name)}.</p><p>${doc.notes ? esc(doc.notes) : ''}</p>`,
      'Employment letter': `<p>To whom it may concern,</p><p>This is to confirm that <b>${esc(fullName)}</b>, staff number <b>${esc(st?.staff_no)}</b>, is employed by ${esc(sch.school_name)} as <b>${esc(st?.job_title)}</b> in the ${esc(st?.department)} department since ${date(st?.hired_on)}.</p><p>${doc.notes ? esc(doc.notes) : 'This letter is issued at the request of the employee.'}</p>`,
    };
    html = `<article class="paper letter">${headHtml}<p class="muted small">Kigali, ${new Date(doc.issued_at.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</p>${letters[doc.doc_type] || ''}${sign}</article>`;
  }
  body.innerHTML = html;
  el.querySelector('#print').onclick = () => window.print();
}

// ============ TWO-STEP SIGN-IN (settings card) ============
export function mfaCard() {
  const u = state.user;
  return card('Two-step sign-in', `<p class="muted">${u.mfa_enabled ? '✓ On. You will be asked for a 6-digit code from your authenticator app at every sign-in.' : u.privileged ? '<b class="bad-text">Recommended for your role.</b> Protects school finances and personal data even if your password is stolen.' : 'Adds a 6-digit code from an authenticator app (Google or Microsoft Authenticator) to your sign-in.'}</p>
    <button class="btn ${u.mfa_enabled ? 'ghost' : 'primary'}" id="mfa-btn">${icon('key', 18)} ${u.mfa_enabled ? 'Turn off' : 'Set up two-step sign-in'}</button>`);
}
export function bindMfa(root) {
  const b = root.querySelector('#mfa-btn'); if (!b) return;
  b.onclick = async () => {
    if (state.user.mfa_enabled) {
      return formModal({ title: 'Turn off two-step sign-in', fields: [{ name: 'password', label: 'Confirm your password', type: 'password', required: true, full: true }], submitText: 'Turn off', onSubmit: async (d, close) => { await api('/mfa/disable', { method: 'POST', body: d }); state.user.mfa_enabled = false; close(); toast('Two-step sign-in turned off', 'info'); location.reload(); } });
    }
    const s = await api('/mfa/setup', { method: 'POST' });
    modal({ title: 'Set up two-step sign-in', body: `<ol class="steps"><li>Install <b>Google Authenticator</b> or <b>Microsoft Authenticator</b> on your phone.</li><li>Choose <i>Add account → Enter a setup key</i>, then type this key (time-based):<div class="secret mono">${s.secret.match(/.{1,4}/g).join(' ')}</div></li><li>Enter the 6-digit code the app shows:</li></ol><form id="mfa-f" class="form-grid"><label class="field full"><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123 456" required class="code-input"></label><p class="form-error" hidden></p></form>`,
      actions: `<button class="btn ghost" data-close>${t('Cancel')}</button><button class="btn primary" form="mfa-f">Turn on</button>`,
      onOpen: (el, close) => { el.querySelector('form').onsubmit = async (e) => { e.preventDefault(); try { await api('/mfa/enable', { method: 'POST', body: { code: e.target.elements.code.value } }); close(); toast('Two-step sign-in is on', 'success'); state.user.mfa_enabled = true; location.reload(); } catch (er) { const p = el.querySelector('.form-error'); p.hidden = false; p.textContent = er.message; } }; } });
  };
}
