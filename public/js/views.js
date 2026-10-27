// Page views. Each view receives (el, params, query) and renders into el.
import {
  state, api, saveOrQueue, t, esc, money, num, pct, date, today, initials, label, gradeClass, can, icon, toast, modal, confirmBox,
  formModal, dataTable, exportRows, kpi, badge, statusTone, empty, loading, tabs, barChart, lineChart, donut, meter, opt, className, currentTermId,
} from './core.js';

const go = (h) => { location.hash = h; };
function header(el, title, { sub = '', actions = '', back } = {}) {
  el.innerHTML = `<div class="page-head">
      <div>${back ? `<a class="back" href="${back}">‹ Back</a>` : ''}<h1>${esc(title)}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}</div>
      <div class="page-actions">${actions}</div>
    </div><div class="page-body"></div>`;
  document.title = `${title} · ${state.meta?.school?.school_name || 'SMIS'}`;
  return el.querySelector('.page-body');
}
const btn = (text, id, { ic, kind = 'primary', attrs = '' } = {}) => `<button class="btn ${kind}" id="${id}" ${attrs}>${ic ? icon(ic, 18) : ''}<span>${esc(text)}</span></button>`;
const card = (title, body, { actions = '', cls = '' } = {}) => `<section class="card ${cls}">${title ? `<header class="card-head"><h3>${esc(title)}</h3>${actions}</header>` : ''}<div class="card-body">${body}</div></section>`;
const filterBar = (fields) => `<div class="filters">${fields.join('')}</div>`;
const sel = (id, options, value, lbl, { blank } = {}) => `<label class="mini-field"><span>${esc(lbl)}</span><select id="${id}">${blank ? `<option value="">${esc(blank)}</option>` : ''}${options.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
const inp = (id, type, value, lbl) => `<label class="mini-field"><span>${esc(lbl)}</span><input id="${id}" type="${type}" value="${esc(value ?? '')}"></label>`;
const studentOptions = async () => (await api('/r/students?status=Active&limit=5000')).rows.map((s) => [s.id, `${s.first_name} ${s.last_name} (${s.adm_no}) · ${s.class_name || ''}`]);
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const attTone = { P: 'good', L: 'warn', A: 'bad', E: 'info' };
const attName = { P: 'Present', L: 'Late', A: 'Absent', E: 'Excused' };

// ============ DASHBOARD ============
export async function dashboard(el) {
  const body = header(el, `${greeting()}, ${state.user.full_name.split(' ')[0]}`, { sub: `${esc(state.user.roleLabel)} · ${esc(state.meta.currentTerm?.name || '')} · ${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}` });
  body.innerHTML = loading();
  if (['parent', 'student'].includes(state.user.role)) return portal(el);
  const d = await api('/dashboard');
  const k = [];
  if (d.students) k.push(kpi({ label: 'Enrolled students', value: num(d.students.n), sub: `${num(d.students.f)} girls · ${num(d.students.m)} boys`, ic: 'cap', href: '#/students' }));
  if (d.staff) k.push(kpi({ label: 'Staff members', value: num(d.staff.n), sub: `${num(d.staff.teachers)} teachers`, ic: 'idcard', href: '#/staff', tone: 't2' }));
  if (d.finance) k.push(kpi({ label: t('Fees collected'), value: pct(d.finance.rate), sub: `${money(d.finance.collected)} of ${money(d.finance.billed)}`, ic: 'money', href: '#/finance', tone: 't3' }));
  if (d.attendance) k.push(kpi({ label: t('Average attendance'), value: pct(d.attendance.rate), sub: d.attendanceToday?.total ? `Today: ${pct(d.attendanceToday.rate)}` : 'Last 30 days', ic: 'check', href: '#/attendance', tone: 't4', spark: d.attendanceTrend?.map((x) => x.value) }));
  if (d.system) k.push(kpi({ label: 'Active users', value: num(d.system.users), sub: `${d.system.sessions} signed in now`, ic: 'users', href: '#/users' }), kpi({ label: 'Failed logins (24h)', value: num(d.system.failedLogins), sub: 'Watch for brute force', ic: 'shield', tone: d.system.failedLogins > 5 ? 'bad' : 't2', href: '#/audit' }), kpi({ label: 'Database size', value: `${(d.system.dbSize / 1048576).toFixed(1)} MB`, sub: 'Back up regularly', ic: 'box', tone: 't3', href: '#/settings' }));
  if (d.myClasses) k.push(kpi({ label: 'My classes', value: d.myClasses.length, sub: `${d.myClasses.reduce((a, b) => a + b.students, 0)} students`, ic: 'cap' }), kpi({ label: 'Lessons today', value: d.todayLessons.length, sub: d.todayLessons[0] ? `Next: P${d.todayLessons[0].period} ${d.todayLessons[0].subject}` : 'No lessons', ic: 'calendar', tone: 't2', href: '#/timetable' }));

  // Alerts that need someone to act
  const alerts = [];
  if (d.absentees?.length) alerts.push({ tone: 'bad', ic: 'alert', text: `${d.absentees.length} student(s) absent 3+ times in the last 10 school days`, href: '#/reports?r=absentees' });
  if (d.pendingLeave?.length) alerts.push({ tone: 'warn', ic: 'calendar', text: `${d.pendingLeave.length} leave request(s) awaiting a decision`, href: '#/staff?tab=leave' });
  if (d.pendingExpenses?.length && can('approve_expense', 'w')) alerts.push({ tone: 'warn', ic: 'wallet', text: `${d.pendingExpenses.length} expense(s) awaiting your approval`, href: '#/finance?tab=expenses' });
  if (d.unapprovedMarks) alerts.push({ tone: 'info', ic: 'clip', text: `${num(d.unapprovedMarks)} mark(s) entered by teachers need approval`, href: '#/marks?tab=approve' });
  if (d.expiringContracts?.length) alerts.push({ tone: 'warn', ic: 'idcard', text: `${d.expiringContracts.length} staff contract(s) end within 120 days`, href: '#/staff' });
  if (d.overdueBooks) alerts.push({ tone: 'info', ic: 'library', text: `${d.overdueBooks} library book(s) overdue`, href: '#/library?tab=loans' });
  if (d.lowStock?.length) alerts.push({ tone: 'info', ic: 'box', text: `Low stock: ${d.lowStock.map((x) => `${x.item} (${x.quantity})`).join(', ')}`, href: '#/inventory' });
  if (d.myClasses) d.myClasses.filter((c) => !c.marked_today).forEach((c) => alerts.push({ tone: 'warn', ic: 'check', text: `Attendance not yet taken today for ${c.name}`, href: `#/attendance?class_id=${c.id}` }));

  const quick = [
    can('attendance', 'w') && ['Take attendance', '#/attendance', 'check'], can('marks', 'w') && ['Enter marks', '#/marks', 'clip'],
    can('students', 'w') && ['Register student', '#/students?new=1', 'plus'], can('finance', 'w') && ['Record payment', '#/finance?tab=invoices', 'money'],
    can('finance', 'w') && ['Add expense', '#/finance?tab=expenses&new=1', 'wallet'], can('announcements', 'w') && ['Post announcement', '#/announcements?new=1', 'megaphone'],
    can('reports') && ['View reports', '#/reports', 'chart'], can('users', 'w') && ['Manage users', '#/users', 'users'], ['Calendar', '#/calendar', 'calendar'],
  ].filter(Boolean).slice(0, 6);

  const grid = [];
  if (d.attendanceTrend) grid.push(card('Attendance trend (last 15 school days)', lineChart(d.attendanceTrend, { max: 100, unit: '%' }), { cls: 'span2' }));
  if (d.cashflow) grid.push(card('Cash flow — last 6 months', barChart(d.cashflow, { series: ['income', 'expenses'] }), { cls: 'span2', actions: '<a class="link" href="#/reports?r=cashflow">Full report ›</a>' }));
  if (d.finance?.byMethod) grid.push(card('Payments by channel (this term)', donut(d.finance.byMethod, { fmt: money })));
  if (d.enrollment) grid.push(card('Enrollment by class', barChart(d.enrollment, { height: 200 })));
  if (d.academic) grid.push(card('Academic performance (this term)', barChart(d.academic, { labelKey: 'class', series: ['average', 'pass_rate'], max: 100, unit: '%' }), { cls: 'span2', actions: '<a class="link" href="#/reports?r=academic">Details ›</a>' }));
  if (d.todayLessons) grid.push(card("Today's lessons", d.todayLessons.length ? `<ul class="list">${d.todayLessons.map((l) => `<li><span class="pill">P${l.period}</span><div><b>${esc(l.subject)}</b><small>${esc(l.class_name)} · ${esc(l.room || '')}</small></div></li>`).join('')}</ul>` : empty('No lessons today', 'calendar')));
  if (d.myClasses) grid.push(card('My classes', `<ul class="list">${d.myClasses.map((c) => `<li><span class="avatar sm">${esc(c.name.replace(' ', ''))}</span><div><b>${esc(c.name)}</b><small>${c.students} students</small></div><a class="btn ghost sm" href="#/attendance?class_id=${c.id}">Attendance</a><a class="btn ghost sm" href="#/marks?class_id=${c.id}">Marks</a></li>`).join('')}</ul>`));
  if (d.absentees?.length) grid.push(card('Repeated absences', `<ul class="list">${d.absentees.map((a) => `<li><span class="avatar sm bad">${initials(a.name)}</span><div><a href="#/students/${a.id}"><b>${esc(a.name)}</b></a><small>${esc(a.class_name)} · ${esc(a.guardian_phone || '')}</small></div>${badge(`${a.absences} absences`, 'bad')}</li>`).join('')}</ul>`));
  if (d.pendingLeave?.length) grid.push(card('Leave requests', `<ul class="list">${d.pendingLeave.map((l) => `<li><span class="avatar sm">${initials(l.staff_name)}</span><div><b>${esc(l.staff_name)}</b><small>${esc(l.leave_type)} · ${date(l.start_date)} → ${date(l.end_date)}</small></div>${can('leave', 'w') ? `<button class="btn ghost sm" data-leave="${l.id}" data-s="Approved">Approve</button><button class="btn ghost sm" data-leave="${l.id}" data-s="Rejected">Reject</button>` : ''}</li>`).join('')}</ul>`));
  if (d.pendingExpenses?.length) grid.push(card('Expenses awaiting approval', `<ul class="list">${d.pendingExpenses.map((x) => `<li><span class="avatar sm warn">${icon('wallet', 16)}</span><div><b>${esc(x.description || x.category)}</b><small>${esc(x.supplier || '')} · ${date(x.spent_on)}</small></div><b>${money(x.amount)}</b>${can('approve_expense', 'w') ? `<button class="btn ghost sm" data-exp="${x.id}" data-a="approve">Approve</button>` : ''}</li>`).join('')}</ul>`));
  if (d.recentPayments) grid.push(card('Recent payments', `<ul class="list">${d.recentPayments.map((p) => `<li><span class="avatar sm good">${icon('money', 16)}</span><div><a href="#/receipt/${p.id}"><b>${esc(p.student_name)}</b></a><small>${esc(p.receipt_no)} · ${esc(p.method)} · ${date(p.paid_on)}</small></div><b>${money(p.amount)}</b></li>`).join('')}</ul>`));
  if (d.recentAudit) grid.push(card('Recent activity', `<ul class="list">${d.recentAudit.map((a) => `<li><span class="avatar sm">${icon('log', 16)}</span><div><b>${esc(a.username || 'system')} · ${esc(label(a.action))}</b><small>${esc(a.entity || '')} ${esc(a.entity_id || '')} · ${date(a.at)}</small></div></li>`).join('')}</ul>`, { cls: 'span2' }));
  grid.push(card('Announcements', d.announcements.length ? `<ul class="list">${d.announcements.map((a) => `<li><span class="avatar sm">${icon('megaphone', 16)}</span><div><b>${esc(a.title)}</b>${a.pinned ? badge('Pinned', 'info') : ''}<small>${esc((a.body || '').slice(0, 110))}</small></div></li>`).join('')}</ul>` : empty('Nothing new'), { actions: '<a class="link" href="#/announcements">All ›</a>' }));
  grid.push(card('Upcoming', d.events.length ? `<ul class="list">${d.events.map((e) => { const dt = new Date(e.date + 'T00:00'); return `<li><span class="date-chip"><b>${dt.getDate()}</b>${dt.toLocaleString(undefined, { month: 'short' })}</span><div><b>${esc(e.title)}</b><small>${esc(e.category)} · ${esc(e.description || '')}</small></div></li>`; }).join('')}</ul>` : empty('No upcoming events', 'calendar'), { actions: '<a class="link" href="#/calendar">Calendar ›</a>' }));

  body.innerHTML = `
    <div class="kpis">${k.join('')}</div>
    ${alerts.length ? `<div class="alerts">${alerts.map((a) => `<a class="alert ${a.tone}" href="${a.href}">${icon(a.ic, 18)}<span>${esc(a.text)}</span><b>›</b></a>`).join('')}</div>` : ''}
    <div class="quick">${quick.map(([l, h, ic]) => `<a class="quick-btn" href="${h}">${icon(ic, 22)}<span>${esc(l)}</span></a>`).join('')}</div>
    <div class="grid">${grid.join('')}</div>`;
  body.querySelectorAll('[data-leave]').forEach((b) => (b.onclick = async () => { await api(`/leave/${b.dataset.leave}/decide`, { method: 'POST', body: { status: b.dataset.s } }); toast(`Leave ${b.dataset.s.toLowerCase()}`, 'success'); dashboard(el); }));
  body.querySelectorAll('[data-exp]').forEach((b) => (b.onclick = async () => { await api(`/expenses/${b.dataset.exp}/approve`, { method: 'POST' }); toast('Expense approved', 'success'); dashboard(el); }));
}

// ============ PARENT / STUDENT PORTAL ============
export async function portal(el) {
  const body = header(el, state.user.role === 'parent' ? `${t('Welcome')}, ${state.user.full_name}` : `${t('Welcome')}, ${state.user.full_name.split(' ')[0]}`, { sub: state.user.role === 'parent' ? 'Follow your children\'s progress, attendance and fees' : 'Your results, attendance, fees and timetable' });
  body.innerHTML = loading();
  const [d, ann] = await Promise.all([api('/portal'), api('/r/announcements?limit=5')]);
  body.innerHTML = d.kids.map((k) => {
    const s = k.student, r = k.results;
    return `<section class="card child">
      <header class="child-head"><span class="avatar lg">${initials(s.first_name + ' ' + s.last_name)}</span>
        <div><h2>${esc(s.first_name)} ${esc(s.last_name)}</h2><p class="muted">${esc(s.adm_no)} · ${esc(s.class_name)} · ${esc(s.boarding)}</p></div>
        <div class="page-actions"><a class="btn ghost" href="#/reportcard/${s.id}">${icon('clip', 18)} ${t('Report card')}</a><a class="btn ghost" href="#/timetable?student_id=${s.id}">${icon('calendar', 18)} ${t('Timetable')}</a></div></header>
      <div class="kpis">
        ${kpi({ label: 'Attendance this term', value: pct(k.attendance.rate), sub: `${k.attendance.absent || 0} absences · ${k.attendance.late || 0} late`, ic: 'check', tone: 't4' })}
        ${kpi({ label: 'Term average', value: r?.average != null ? pct(r.average) : '–', sub: r?.position ? `Position ${r.position} · Grade ${r.grade}` : 'Results pending', ic: 'cap', tone: 't2' })}
        ${kpi({ label: 'Fee balance', value: money(k.balance), sub: k.balance > 0 ? 'Please clear before exams' : 'All fees paid ✓', ic: 'money', tone: k.balance > 0 ? 'bad' : 't3' })}
      </div>
      <div class="grid">
        ${card('Recent attendance', `<div class="att-dots">${k.recent.map((a) => `<span class="dot ${attTone[a.status]}" title="${date(a.date)}: ${attName[a.status]}"><b>${a.status}</b><small>${a.date.slice(8)}</small></span>`).join('')}</div>`)}
        ${card('Subject results (this term)', r ? `<div class="table-wrap"><table class="table compact"><thead><tr><th>Subject</th><th class="num">%</th><th>Grade</th></tr></thead><tbody>${r.subjects.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${pct(x.percent)}</td><td><span class="grade ${gradeClass(x.grade)}">${x.grade}</span></td></tr>`).join('')}</tbody></table></div>` : empty('No results yet'))}
        ${card('Invoices & payments', `<ul class="list">${k.invoices.map((i) => `<li><span class="avatar sm ${statusTone(i.status)}">${icon('money', 16)}</span><div><b>${esc(i.term_name)} · ${esc(i.invoice_no)}</b><small>Billed ${money(i.amount)} · Paid ${money(i.paid)}</small></div>${badge(i.status, statusTone(i.status))}</li>`).join('')}</ul><p class="muted small">Pay at the bursar's office, by bank, or by Mobile Money using the admission number <b>${esc(s.adm_no)}</b> as reference.</p>`)}
      </div></section>`;
  }).join('') + card('Announcements', ann.rows.length ? `<ul class="list">${ann.rows.map((a) => `<li><span class="avatar sm">${icon('megaphone', 16)}</span><div><b>${esc(a.title)}</b><small>${esc(a.body)}</small></div></li>`).join('')}</ul>` : empty('No announcements'));
}

// ============ STUDENTS ============
const studentFields = () => [
  { name: 'first_name', label: 'First name', required: true }, { name: 'last_name', label: 'Last name', required: true },
  { name: 'gender', label: 'Gender', type: 'select', options: [['F', 'Female'], ['M', 'Male']], required: true }, { name: 'dob', label: 'Date of birth', type: 'date' },
  { name: 'class_id', label: 'Class', type: 'select', options: opt.classes, required: true }, { name: 'boarding', label: 'Day / Boarding', type: 'select', options: opt.list('Day', 'Boarding'), required: true },
  { name: 'adm_no', label: 'Admission no.', help: 'Leave blank to auto-generate' }, { name: 'enrolled_on', label: 'Enrollment date', type: 'date', default: today() },
  { name: 'guardian_name', label: 'Parent / guardian', required: true }, { name: 'guardian_phone', label: 'Guardian phone', type: 'tel', required: true },
  { name: 'guardian_email', label: 'Guardian email', type: 'email' }, { name: 'emergency_contact', label: 'Emergency contact', type: 'tel' },
  { name: 'address', label: 'Address / district' }, { name: 'status', label: 'Status', type: 'select', options: opt.list('Active', 'Suspended', 'Transferred', 'Graduated', 'Withdrawn'), default: 'Active', required: true },
  { name: 'notes', label: 'Notes', type: 'textarea', full: true },
];
export function editStudent(values, done) {
  formModal({
    title: values?.id ? `Edit ${values.first_name} ${values.last_name}` : 'Register new student', fields: studentFields(), values,
    onSubmit: async (data, close) => {
      if (values?.id) await api(`/r/students/${values.id}`, { method: 'PUT', body: data });
      else { const r = await api('/r/students', { method: 'POST', body: data }); values = { id: r.id }; }
      toast('Student saved', 'success'); close(); done && done(values.id);
    },
  });
}

export async function students(el, _p, query) {
  const body = header(el, t('Students'), { sub: 'Registration, profiles, enrollment and status', actions: can('students', 'w') ? btn('Register student', 'add', { ic: 'plus' }) : '' });
  body.innerHTML = filterBar([sel('f-class', opt.classes(), query.class_id, t('Class'), { blank: 'All classes' }), sel('f-status', opt.list('Active', 'Suspended', 'Transferred', 'Graduated', 'Withdrawn'), query.status ?? 'Active', 'Status', { blank: 'Any status' }), sel('f-gender', [['F', 'Female'], ['M', 'Male']], '', 'Gender', { blank: 'All' }), sel('f-boarding', opt.list('Day', 'Boarding'), '', 'Type', { blank: 'All' })]) + '<div id="tbl"></div>';
  const load = async () => {
    const qs = new URLSearchParams({ limit: 5000, class_id: body.querySelector('#f-class').value, status: body.querySelector('#f-status').value, gender: body.querySelector('#f-gender').value, boarding: body.querySelector('#f-boarding').value });
    const { rows } = await api(`/r/students?${qs}`);
    dataTable(body.querySelector('#tbl'), {
      rows, exportName: 'students', onRow: (r) => go(`#/students/${r.id}`),
      columns: [
        { key: 'name', label: 'Student', value: (r) => `${r.first_name} ${r.last_name}`, html: (r) => `<div class="who"><span class="avatar sm">${initials(r.first_name + ' ' + r.last_name)}</span><div><b>${esc(r.first_name)} ${esc(r.last_name)}</b><small>${esc(r.adm_no)}</small></div></div>` },
        { key: 'adm_no', label: 'Adm. no' }, { key: 'class_name', label: 'Class' }, { key: 'gender', label: 'Gender' }, { key: 'boarding', label: 'Type' },
        { key: 'guardian_name', label: 'Guardian' }, { key: 'guardian_phone', label: 'Phone' },
        { key: 'status', label: 'Status', html: (r) => badge(r.status, statusTone(r.status)) },
      ],
    });
  };
  body.querySelectorAll('select').forEach((s) => (s.onchange = load));
  const add = el.querySelector('#add'); if (add) add.onclick = () => editStudent({}, (id) => go(`#/students/${id}`));
  await load();
  if (query.new && can('students', 'w')) editStudent({}, (id) => go(`#/students/${id}`));
}

export async function studentProfile(el, { id }) {
  const body = header(el, 'Student profile', { back: '#/students' });
  body.innerHTML = loading();
  const d = await api(`/students/${id}/profile`);
  const s = d.student;
  el.querySelector('h1').textContent = `${s.first_name} ${s.last_name}`;
  el.querySelector('.page-actions').innerHTML = `${btn(t('Report card'), 'rc', { ic: 'clip', kind: 'ghost' })}${can('students', 'w') ? btn(t('Edit'), 'edit', { ic: 'cog', kind: 'ghost' }) : ''}${can('finance', 'w') ? btn('Record payment', 'pay', { ic: 'money' }) : ''}`;
  const balance = (d.invoices || []).reduce((a, b) => a + Math.max(0, b.balance), 0);
  body.innerHTML = `
    <section class="card profile-head">
      <span class="avatar xl">${initials(s.first_name + ' ' + s.last_name)}</span>
      <div class="profile-meta"><h2>${esc(s.first_name)} ${esc(s.last_name)} ${badge(s.status, statusTone(s.status))}</h2>
        <p class="muted">${esc(s.adm_no)} · ${esc(s.class_name || 'No class')} · ${s.gender === 'F' ? 'Female' : 'Male'} · ${esc(s.boarding)} · Born ${date(s.dob)}</p>
        <div class="chips"><span>${icon('user', 14)} ${esc(s.guardian_name || '–')}</span><span>📞 ${esc(s.guardian_phone || '–')}</span><span>✉ ${esc(s.guardian_email || '–')}</span><span>🚨 ${esc(s.emergency_contact || '–')}</span><span>📍 ${esc(s.address || '–')}</span></div></div>
      <div class="profile-stats">
        <div><b>${pct(d.attendance.rate)}</b><small>Attendance</small>${meter(d.attendance.rate)}</div>
        <div><b>${d.terms.at(-1)?.average != null ? pct(d.terms.at(-1).average) : '–'}</b><small>Latest average</small></div>
        ${d.invoices ? `<div><b class="${balance > 0 ? 'bad-text' : 'good-text'}">${money(balance)}</b><small>Balance</small></div>` : ''}
      </div>
    </section>
    <div id="ptabs"></div><div id="pbody"></div>`;
  const show = (tab) => {
    const pb = body.querySelector('#pbody');
    if (tab === 'academic') pb.innerHTML = `<div class="grid">${card('Term averages', barChart(d.terms.map((x) => ({ label: x.name, value: x.average })), { max: 100, unit: '%' }))}${card('Results history', `<table class="table"><thead><tr><th>Term</th><th class="num">Average</th><th>Grade</th><th class="num">Position</th><th></th></tr></thead><tbody>${d.terms.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${pct(x.average)}</td><td><span class="grade ${gradeClass(x.grade)}">${x.grade || '-'}</span></td><td class="num">${x.position || '–'}</td><td><a class="link" href="#/reportcard/${s.id}?term_id=${x.id}">Report card ›</a></td></tr>`).join('')}</tbody></table>`)}</div>`;
    if (tab === 'attendance') pb.innerHTML = `<div class="grid">${card('Summary', `<div class="stat-row"><div><b>${d.attendance.present || 0}</b><small>Present</small></div><div><b>${d.attendance.late || 0}</b><small>Late</small></div><div><b>${d.attendance.absent || 0}</b><small>Absent</small></div><div><b>${d.attendance.excused || 0}</b><small>Excused</small></div></div>${meter(d.attendance.rate)}`)}${card('Last 30 records', `<div class="att-dots">${d.attendanceLog.map((a) => `<span class="dot ${attTone[a.status]}" title="${date(a.date)}: ${attName[a.status]}"><b>${a.status}</b><small>${a.date.slice(5)}</small></span>`).join('')}</div>`, { cls: 'span2' })}</div>`;
    if (tab === 'finance') { pb.innerHTML = '<div id="inv"></div><h3 class="section-title">Payments</h3><div id="pay"></div>'; dataTable(pb.querySelector('#inv'), { rows: d.invoices, searchable: false, columns: ['invoice_no', 'term_name', { key: 'amount', label: 'Billed', num: true, html: (r) => money(r.amount) }, { key: 'paid', num: true, html: (r) => money(r.paid) }, { key: 'balance', num: true, html: (r) => money(r.balance) }, { key: 'status', html: (r) => badge(r.status, statusTone(r.status)) }] }); dataTable(pb.querySelector('#pay'), { rows: d.payments, searchable: false, onRow: (r) => go(`#/receipt/${r.id}`), columns: ['receipt_no', { key: 'paid_on', label: 'Date', html: (r) => date(r.paid_on) }, 'method', 'reference', { key: 'amount', num: true, html: (r) => money(r.amount) }, { key: 'reversed', label: 'State', html: (r) => (r.reversed ? badge('Reversed', 'bad') : badge('Valid', 'good')) }] }); }
    if (tab === 'discipline') { pb.innerHTML = '<div id="dis"></div>'; dataTable(pb.querySelector('#dis'), { rows: d.discipline, searchable: false, empty: 'No incidents recorded 👍', columns: [{ key: 'date', html: (r) => date(r.date) }, 'incident', 'action_taken', { key: 'status', html: (r) => badge(r.status, statusTone(r.status)) }] }); }
    if (tab === 'library') { pb.innerHTML = '<div id="lib"></div>'; dataTable(pb.querySelector('#lib'), { rows: d.loans, searchable: false, empty: 'No books borrowed', columns: ['title', { key: 'borrowed_on', html: (r) => date(r.borrowed_on) }, { key: 'due_on', html: (r) => date(r.due_on) }, { key: 'returned_on', html: (r) => (r.returned_on ? date(r.returned_on) : badge('On loan', 'info')) }, { key: 'fine', num: true, html: (r) => money(r.fine) }] }); }
  };
  tabs(body.querySelector('#ptabs'), [['academic', 'Academics'], ['attendance', 'Attendance'], ...(d.invoices ? [['finance', 'Finance']] : []), ...(d.discipline ? [['discipline', 'Discipline']] : []), ['library', 'Library']], 'academic', show);
  show('academic');
  el.querySelector('#rc').onclick = () => go(`#/reportcard/${s.id}`);
  const e = el.querySelector('#edit'); if (e) e.onclick = () => editStudent(s, () => studentProfile(el, { id }));
  const p = el.querySelector('#pay'); if (p) p.onclick = () => { const inv = (d.invoices || []).find((i) => i.balance > 0) || d.invoices?.[0]; if (!inv) return toast('No invoice for this student yet', 'error'); payModal(inv, () => studentProfile(el, { id })); };
}

// ============ STAFF & HR ============
export async function staff(el, _p, query) {
  const canSal = can('salaries');
  const body = header(el, t('Staff'), { sub: 'Employees, contracts, leave and staff attendance', actions: `${btn('Request leave', 'reqleave', { ic: 'calendar', kind: 'ghost' })}${can('staff', 'w') ? btn('Add staff', 'add', { ic: 'plus' }) : ''}` });
  const fields = [
    { name: 'first_name', label: 'First name', required: true }, { name: 'last_name', label: 'Last name', required: true }, { name: 'gender', label: 'Gender', type: 'select', options: [['F', 'Female'], ['M', 'Male']] },
    { name: 'job_title', label: 'Job title', required: true, list: ['Teacher', 'Head Teacher', 'Bursar', 'Librarian', 'Nurse', 'Driver', 'Cook', 'Secretary', 'Security'] },
    { name: 'department', label: 'Department', required: true, list: ['Sciences', 'Languages', 'Humanities', 'ICT', 'Administration', 'Finance', 'Library', 'Boarding', 'Transport', 'Health'] },
    { name: 'qualification', label: 'Qualification' }, { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' },
    ...(canSal ? [{ name: 'salary', label: 'Monthly salary (RWF)', type: 'number', min: 0 }] : []),
    { name: 'hired_on', label: 'Hired on', type: 'date' }, { name: 'contract_end', label: 'Contract ends', type: 'date' }, { name: 'status', label: 'Status', type: 'select', options: opt.list('Active', 'On leave', 'Suspended', 'Left'), default: 'Active', required: true },
  ];
  const edit = (v = {}) => formModal({ title: v.id ? `Edit ${v.first_name} ${v.last_name}` : 'Add staff member', fields, values: v, onSubmit: async (data, close) => { await api(v.id ? `/r/staff/${v.id}` : '/r/staff', { method: v.id ? 'PUT' : 'POST', body: data }); toast('Staff saved', 'success'); close(); show('list'); } });
  body.innerHTML = '<div id="t"></div><div id="b"></div>';
  const show = async (tab) => {
    const b = body.querySelector('#b'); b.innerHTML = loading();
    if (tab === 'list') {
      if (!can('staff')) { b.innerHTML = empty('Only HR and administration can view the staff directory', 'shield'); return; }
      const { rows } = await api('/r/staff?limit=1000');
      const soon = new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10);
      dataTable(b, { rows, exportName: 'staff', onRow: can('staff', 'w') ? (r) => edit(r) : null, columns: [
        { key: 'name', label: 'Name', value: (r) => `${r.first_name} ${r.last_name}`, html: (r) => `<div class="who"><span class="avatar sm">${initials(r.first_name + ' ' + r.last_name)}</span><div><b>${esc(r.first_name)} ${esc(r.last_name)}</b><small>${esc(r.staff_no)}</small></div></div>` },
        'job_title', 'department', 'qualification', 'phone', ...(canSal ? [{ key: 'salary', num: true, html: (r) => money(r.salary) }] : []),
        { key: 'contract_end', label: 'Contract ends', html: (r) => `${date(r.contract_end)} ${r.contract_end && r.contract_end <= soon ? badge('Soon', 'warn') : ''}` },
        { key: 'status', html: (r) => badge(r.status, statusTone(r.status)) }] });
      if (query.id) { const r = rows.find((x) => x.id == query.id); if (r && can('staff', 'w')) edit(r); }
    }
    if (tab === 'leave') {
      const { rows } = await api('/r/leave_requests?limit=500');
      dataTable(b, { rows, exportName: 'leave', columns: ['staff_name', 'job_title', 'leave_type', { key: 'start_date', label: 'From', html: (r) => date(r.start_date) }, { key: 'end_date', label: 'To', html: (r) => date(r.end_date) }, 'reason',
        { key: 'status', html: (r) => badge(r.status, statusTone(r.status)) },
        { key: 'act', label: '', html: (r) => (r.status === 'Pending' && can('leave', 'w') ? `<button class="btn ghost sm" data-l="${r.id}" data-s="Approved">Approve</button> <button class="btn ghost sm" data-l="${r.id}" data-s="Rejected">Reject</button>` : '') }] });
      b.onclick = async (e) => { const x = e.target.closest('[data-l]'); if (!x) return; await api(`/leave/${x.dataset.l}/decide`, { method: 'POST', body: { status: x.dataset.s } }); toast(`Leave ${x.dataset.s.toLowerCase()}`, 'success'); show('leave'); };
    }
    if (tab === 'attendance') {
      const dt = query.date || today();
      b.innerHTML = filterBar([inp('sa-date', 'date', dt, 'Date')]) + '<div id="sa"></div>';
      const load = async () => {
        const d = await api(`/staff-attendance?date=${b.querySelector('#sa-date').value}`);
        const rec = Object.fromEntries(d.rows.map((r) => [r.id, r.status || 'P']));
        const sa = b.querySelector('#sa');
        sa.innerHTML = `<div class="roll">${d.rows.map((r) => `<div class="roll-row"><div class="who"><span class="avatar sm">${initials(r.name)}</span><div><b>${esc(r.name)}</b><small>${esc(r.job_title)}</small></div></div><div class="seg" data-id="${r.id}">${['P', 'L', 'A', 'E'].map((s) => `<button class="${rec[r.id] === s ? `on ${attTone[s]}` : ''}" data-s="${s}" title="${attName[s]}" ${can('staff_attendance', 'w') ? '' : 'disabled'}>${s}</button>`).join('')}</div></div>`).join('')}</div>${can('staff_attendance', 'w') ? `<div class="sticky-save">${btn(t('Save'), 'sa-save', { ic: 'check' })}</div>` : ''}`;
        sa.querySelectorAll('.seg button').forEach((x) => (x.onclick = () => { const seg = x.parentElement; rec[seg.dataset.id] = x.dataset.s; seg.querySelectorAll('button').forEach((y) => (y.className = y === x ? `on ${attTone[y.dataset.s]}` : '')); }));
        const sv = sa.querySelector('#sa-save'); if (sv) sv.onclick = async () => { await api('/staff-attendance', { method: 'POST', body: { date: b.querySelector('#sa-date').value, records: Object.entries(rec).map(([staff_id, status]) => ({ staff_id: Number(staff_id), status })) } }); toast('Staff attendance saved', 'success'); };
      };
      b.querySelector('#sa-date').onchange = load; load();
    }
  };
  const tabList = [...(can('staff') ? [['list', 'Directory']] : []), ['leave', 'Leave requests'], ...(can('staff_attendance') ? [['attendance', 'Staff attendance']] : [])];
  const first = query.tab && tabList.some((x) => x[0] === query.tab) ? query.tab : tabList[0][0];
  tabs(body.querySelector('#t'), tabList, first, show); show(first);
  const a = el.querySelector('#add'); if (a) a.onclick = () => edit();
  el.querySelector('#reqleave').onclick = () => formModal({ title: 'Request leave / permission', fields: [{ name: 'leave_type', label: 'Type', type: 'select', options: opt.list('Annual', 'Sick', 'Maternity', 'Paternity', 'Permission', 'Study', 'Other'), required: true }, { name: 'start_date', label: 'From', type: 'date', required: true, default: today() }, { name: 'end_date', label: 'To', type: 'date', required: true, default: today() }, { name: 'reason', label: 'Reason', type: 'textarea', full: true }], onSubmit: async (data, close) => { await api('/leave/request', { method: 'POST', body: data }); toast('Leave request sent to HR', 'success'); close(); show('leave'); } });
}

// ============ ACADEMICS SETUP ============
export async function academics(el, _p, query) {
  const body = header(el, t('Academics'), { sub: 'Classes, streams, subjects, teacher assignments and assessments' });
  body.innerHTML = '<div id="t"></div><div id="b"></div>';
  const w = can('academics', 'w');
  const conf = {
    classes: { res: 'classes', cols: ['name', 'level', 'stream', 'teacher_name', { key: 'enrolled', num: true, html: (r) => `${r.enrolled} / ${r.capacity} ${meter((r.enrolled / r.capacity) * 100, { tone: r.enrolled > r.capacity ? 'bad' : 'good' })}` }], fields: [{ name: 'name', label: 'Class name', required: true, placeholder: 'S4 MPC' }, { name: 'level', label: 'Level', required: true }, { name: 'stream', label: 'Stream' }, { name: 'class_teacher_id', label: 'Class teacher', type: 'select', options: opt.teachers }, { name: 'capacity', label: 'Capacity', type: 'number', default: 45 }] },
    subjects: { res: 'subjects', cols: ['code', 'name', 'department'], fields: [{ name: 'code', label: 'Code', required: true }, { name: 'name', label: 'Subject name', required: true }, { name: 'department', label: 'Department', list: ['Sciences', 'Languages', 'Humanities', 'ICT'] }] },
    teacher_assignments: { res: 'teacher_assignments', cols: ['class_name', 'subject_name', 'teacher_name'], fields: [{ name: 'class_id', label: 'Class', type: 'select', options: opt.classes, required: true }, { name: 'subject_id', label: 'Subject', type: 'select', options: opt.subjects, required: true }, { name: 'teacher_id', label: 'Teacher', type: 'select', options: opt.teachers, required: true }] },
    assessments: { res: 'assessments', cols: ['term_name', 'name', { key: 'max_score', label: 'Out of', num: true }], fields: [{ name: 'term_id', label: 'Term', type: 'select', options: opt.terms, required: true, default: currentTermId() }, { name: 'name', label: 'Assessment name', required: true, placeholder: 'CAT, Exam, Project…' }, { name: 'max_score', label: 'Maximum score', type: 'number', min: 1, required: true }] },
    terms: { res: 'terms', cols: ['year_name', 'name', { key: 'start_date', html: (r) => date(r.start_date) }, { key: 'end_date', html: (r) => date(r.end_date) }, { key: 'is_current', label: 'Current', html: (r) => (r.is_current ? badge('Current', 'good') : '') }], fields: [{ name: 'year_id', label: 'Academic year id', type: 'number', default: 1, required: true }, { name: 'name', label: 'Term name', required: true }, { name: 'start_date', label: 'Starts', type: 'date', required: true }, { name: 'end_date', label: 'Ends', type: 'date', required: true }] },
  };
  const show = async (tab) => {
    const c = conf[tab]; const b = body.querySelector('#b'); b.innerHTML = loading();
    const { rows } = await api(`/r/${c.res}?limit=2000`);
    const edit = (v = {}) => formModal({ title: v.id ? 'Edit' : `Add ${label(tab).replace(/s$/, '')}`, fields: c.fields, values: v, onSubmit: async (data, close) => { await api(v.id ? `/r/${c.res}/${v.id}` : `/r/${c.res}`, { method: v.id ? 'PUT' : 'POST', body: data }); toast('Saved', 'success'); close(); await refreshMeta(); show(tab); } });
    dataTable(b, { rows, exportName: tab, onRow: w ? edit : null, toolbar: w ? `<button class="btn primary sm" id="addrow">${icon('plus', 16)} ${t('Add')}</button>` : '', columns: [...c.cols, ...(w ? [{ key: 'x', label: '', html: (r) => `<button class="icon-btn danger" data-del="${r.id}" title="${t('Delete')}">${icon('x', 16)}</button>` }] : [])] });
    const add = b.querySelector('#addrow'); if (add) add.onclick = () => edit();
    b.querySelectorAll('[data-del]').forEach((x) => (x.onclick = async (e) => { e.stopPropagation(); if (!(await confirmBox('Delete this record?', { danger: true, okText: t('Delete') }))) return; try { await api(`/r/${c.res}/${x.dataset.del}`, { method: 'DELETE' }); toast('Deleted', 'success'); await refreshMeta(); show(tab); } catch (er) { toast(er.message, 'error'); } }));
  };
  const first = query.tab || 'classes';
  tabs(body.querySelector('#t'), [['classes', 'Classes & streams'], ['subjects', 'Subjects'], ['teacher_assignments', 'Teacher assignments'], ['assessments', 'Assessments'], ['terms', 'Terms']], first, show); show(first);
}
async function refreshMeta() { state.meta = await api('/meta'); }

// ============ TIMETABLE ============
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
export async function timetable(el, _p, query) {
  const body = header(el, t('Timetable'), { sub: can('timetable', 'w') ? 'Click a slot to change it — teacher and room clashes are detected automatically' : 'Weekly lesson schedule' });
  const isStaff = !['parent', 'student'].includes(state.user.role);
  const mode = query.teacher_id ? 'teacher' : 'class';
  const defaultClass = query.class_id || state.meta.myClasses?.[0] || state.meta.classes[0]?.id;
  body.innerHTML = (isStaff ? filterBar([sel('tt-mode', [['class', 'By class'], ['teacher', 'By teacher']], mode, 'View'), sel('tt-class', opt.classes(), defaultClass, t('Class')), sel('tt-teacher', opt.teachers(), query.teacher_id || state.user.staff_id || '', 'Teacher'), `<button class="btn ghost" id="tt-print">${icon('print', 18)} ${t('Print')}</button>`]) : '') + '<div id="conf"></div><div id="tt"></div>';
  const load = async () => {
    const m = isStaff ? body.querySelector('#tt-mode').value : 'class';
    if (isStaff) { body.querySelector('#tt-class').parentElement.hidden = m !== 'class'; body.querySelector('#tt-teacher').parentElement.hidden = m !== 'teacher'; }
    const qs = !isStaff ? `student_id=${query.student_id || ''}` : m === 'class' ? `class_id=${body.querySelector('#tt-class').value}` : `teacher_id=${body.querySelector('#tt-teacher').value}`;
    const [rows, conflicts] = await Promise.all([api(`/timetable?${qs}`), isStaff ? api('/timetable/conflicts') : []]);
    const at = (d, p) => rows.find((r) => r.day === d && r.period === p);
    const times = ['08:00', '08:50', '09:40', '11:00', '11:50', '14:00'];
    body.querySelector('#conf').innerHTML = conflicts.length ? `<div class="alerts">${conflicts.map((c) => `<div class="alert bad">${icon('alert', 18)}<span>Clash: ${esc(c.teacher)} on ${c.day} P${c.period} — ${esc(c.classes)}</span></div>`).join('')}</div>` : '';
    const editable = can('timetable', 'w') && m === 'class';
    body.querySelector('#tt').innerHTML = `<div class="tt-wrap"><table class="tt"><thead><tr><th></th>${DAYS.map((d) => `<th>${d}</th>`).join('')}</tr></thead><tbody>
      ${[1, 2, 3, 4, 5, 6].map((p) => `${p === 4 ? `<tr class="break"><td colspan="6">Break</td></tr>` : ''}<tr><th><b>P${p}</b><small>${times[p - 1]}</small></th>${DAYS.map((d) => { const s = at(d, p); return `<td class="${s ? `sub-${(s.code || '').toLowerCase()}` : 'free'} ${editable ? 'editable' : ''}" data-d="${d}" data-p="${p}">${s ? `<b>${esc(s.subject)}</b><small>${esc(m === 'teacher' ? s.class_name : s.teacher || '')}</small><small>${esc(s.room || '')}</small>` : '<small>Free</small>'}</td>`; }).join('')}</tr>`).join('')}
      </tbody></table></div>`;
    if (editable) body.querySelectorAll('td.editable').forEach((td) => (td.onclick = () => {
      const s = at(td.dataset.d, Number(td.dataset.p));
      const classId = body.querySelector('#tt-class').value;
      formModal({ title: `${className(classId)} · ${td.dataset.d} period ${td.dataset.p}`, fields: [{ name: 'subject_id', label: 'Subject (empty = free period)', type: 'select', options: opt.subjects }, { name: 'teacher_id', label: 'Teacher (default: assigned teacher)', type: 'select', options: opt.teachers }, { name: 'room', label: 'Room' }], values: s || { room: `Room ${classId}` },
        onSubmit: async (data, close) => { await api('/timetable', { method: 'POST', body: { ...data, class_id: Number(classId), day: td.dataset.d, period: Number(td.dataset.p) } }); toast('Timetable updated', 'success'); close(); load(); } });
    }));
  };
  if (isStaff) { body.querySelectorAll('select').forEach((s) => (s.onchange = load)); body.querySelector('#tt-print').onclick = () => window.print(); }
  load();
}

// ============ ATTENDANCE ============
export async function attendance(el, _p, query) {
  const body = header(el, t('Attendance'), { sub: 'Daily register — works offline and syncs automatically when the connection returns' });
  const classes = opt.myClasses();
  if (!classes.length) { body.innerHTML = empty('You are not assigned to any class yet', 'check'); return; }
  body.innerHTML = filterBar([sel('a-class', classes, query.class_id || classes[0][0], t('Class')), inp('a-date', 'date', query.date || today(), 'Date')]) + '<div id="roll"></div>';
  const load = async () => {
    const classId = body.querySelector('#a-class').value, dt = body.querySelector('#a-date').value;
    const roll = body.querySelector('#roll'); roll.innerHTML = loading();
    let d;
    try { d = await api(`/attendance?class_id=${classId}&date=${dt}`); }
    catch (e) { roll.innerHTML = empty(e.message, 'wifi'); return; }
    const rec = Object.fromEntries(d.rows.map((r) => [r.id, r.status || 'P']));
    const taken = d.rows.some((r) => r.status);
    const w = can('attendance', 'w');
    const summary = () => { const c = { P: 0, L: 0, A: 0, E: 0 }; Object.values(rec).forEach((s) => c[s]++); return `<div class="stat-row">${['P', 'L', 'A', 'E'].map((s) => `<div class="${attTone[s]}"><b>${c[s]}</b><small>${t(attName[s])}</small></div>`).join('')}<div><b>${pct(((c.P + c.L) / Math.max(1, d.rows.length)) * 100)}</b><small>Rate</small></div></div>`; };
    roll.innerHTML = `${card('', `<div class="roll-head"><div id="sum">${summary()}</div><div>${taken ? badge('Already recorded — editing', 'info') : badge('Not yet recorded', 'warn')} ${w ? `<button class="btn ghost sm" id="allp">${icon('check', 16)} ${t('Mark all present')}</button>` : ''}</div></div>`)}
      <div class="roll">${d.rows.map((r, i) => `<div class="roll-row"><span class="idx">${i + 1}</span><div class="who"><span class="avatar sm">${initials(r.name)}</span><div><a href="#/students/${r.id}"><b>${esc(r.name)}</b></a><small>${esc(r.adm_no)} · overall ${pct(r.rate)}</small></div></div>
        <div class="seg" data-id="${r.id}">${['P', 'L', 'A', 'E'].map((s) => `<button class="${rec[r.id] === s ? `on ${attTone[s]}` : ''}" data-s="${s}" title="${t(attName[s])}" aria-label="${t(attName[s])}" ${w ? '' : 'disabled'}>${s}</button>`).join('')}</div></div>`).join('')}</div>
      ${w ? `<div class="sticky-save"><span class="muted small">Tap P / L / A / E for each student. If the network drops, the register is kept on this device.</span>${btn('Save register', 'save', { ic: 'check' })}</div>` : ''}`;
    const paint = (seg, s) => seg.querySelectorAll('button').forEach((y) => (y.className = y.dataset.s === s ? `on ${attTone[s]}` : ''));
    roll.querySelectorAll('.seg button').forEach((x) => (x.onclick = () => { const seg = x.parentElement; rec[seg.dataset.id] = x.dataset.s; paint(seg, x.dataset.s); roll.querySelector('#sum').innerHTML = summary(); }));
    const ap = roll.querySelector('#allp'); if (ap) ap.onclick = () => { roll.querySelectorAll('.seg').forEach((seg) => { rec[seg.dataset.id] = 'P'; paint(seg, 'P'); }); roll.querySelector('#sum').innerHTML = summary(); };
    const sv = roll.querySelector('#save'); if (sv) sv.onclick = async () => {
      sv.disabled = true;
      try {
        const r = await saveOrQueue('/attendance', { class_id: Number(classId), date: dt, records: Object.entries(rec).map(([student_id, status]) => ({ student_id: Number(student_id), status })) }, `attendance ${className(classId)} ${dt}`);
        toast(r.queued ? 'Offline: register saved on this device and will sync automatically' : `Register saved (${r.saved} students)`, r.queued ? 'info' : 'success');
        const absent = Object.values(rec).filter((s) => s === 'A').length;
        if (!r.queued && absent) toast(`${absent} absent today — guardians can be contacted from the absentee report`, 'info');
      } catch (e) { toast(e.message, 'error'); } finally { sv.disabled = false; }
    };
  };
  body.querySelectorAll('select,input').forEach((s) => (s.onchange = load));
  load();
}

// ============ MARKS & EXAMS ============
export async function marks(el, _p, query) {
  const body = header(el, t('Marks & exams'), { sub: 'Enter marks, approve them, then rank classes and print report cards' });
  body.innerHTML = '<div id="t"></div><div id="b"></div>';
  const tabList = [...(can('marks', 'w') ? [['entry', 'Mark entry']] : []), ['results', 'Class results & ranking'], ...(can('approve_marks', 'w') ? [['approve', 'Approvals']] : [])];
  const show = async (tab) => {
    const b = body.querySelector('#b');
    if (tab === 'entry') {
      const classes = opt.myClasses();
      const curAs = state.meta.assessments.filter((a) => a.term_id === currentTermId());
      b.innerHTML = filterBar([sel('m-class', classes, query.class_id || classes[0]?.[0], t('Class')), sel('m-subj', opt.subjects(), query.subject_id || '', 'Subject'), sel('m-as', state.meta.assessments.map((a) => [a.id, `${a.name} /${a.max_score} · ${state.meta.terms.find((x) => x.id === a.term_id)?.name}`]), curAs.at(-1)?.id, 'Assessment')]) + '<div id="grid"></div>';
      const load = async () => {
        const g = b.querySelector('#grid'); g.innerHTML = loading();
        const c = b.querySelector('#m-class').value, s = b.querySelector('#m-subj').value, a = b.querySelector('#m-as').value;
        let d;
        try { d = await api(`/marks?class_id=${c}&subject_id=${s}&assessment_id=${a}`); } catch (e) { g.innerHTML = empty(e.message, 'shield'); return; }
        const max = d.assessment.max_score;
        g.innerHTML = `${card('', `<div class="roll-head"><div class="stat-row" id="mstat"></div><span class="muted small">Scores out of <b>${max}</b>. Press Enter to jump to the next student. Changed marks need head-teacher approval.</span></div>`)}
          <div class="table-wrap"><table class="table marks"><thead><tr><th>#</th><th>Student</th><th class="num">Score /${max}</th><th class="num">%</th><th>Status</th></tr></thead><tbody>
          ${d.rows.map((r, i) => `<tr><td>${i + 1}</td><td><b>${esc(r.name)}</b><small class="muted"> ${esc(r.adm_no)}</small></td><td class="num"><input class="score" type="number" inputmode="decimal" min="0" max="${max}" step="0.5" data-id="${r.id}" value="${r.score ?? ''}" aria-label="Score for ${esc(r.name)}"></td><td class="num pc">${r.score != null ? pct((r.score / max) * 100) : '–'}</td><td>${r.score == null ? badge('Missing', 'warn') : r.approved ? badge('Approved', 'good') : badge('Pending', 'info')}</td></tr>`).join('')}
          </tbody></table></div><div class="sticky-save">${btn('Save marks', 'msave', { ic: 'check' })}</div>`;
        const inputs = [...g.querySelectorAll('.score')];
        const stat = () => { const v = inputs.map((x) => x.value).filter((x) => x !== '').map(Number); const avg = v.length ? v.reduce((a2, b2) => a2 + b2, 0) / v.length : 0; g.querySelector('#mstat').innerHTML = `<div><b>${v.length}/${inputs.length}</b><small>Entered</small></div><div><b>${pct((avg / max) * 100)}</b><small>Average</small></div><div class="good"><b>${v.filter((x) => x / max >= 0.5).length}</b><small>Passed</small></div><div class="bad"><b>${v.filter((x) => x / max < 0.5).length}</b><small>Below 50%</small></div>`; };
        inputs.forEach((x, i) => {
          x.oninput = () => { const v = Number(x.value); x.classList.toggle('invalid', x.value !== '' && (v < 0 || v > max)); x.closest('tr').querySelector('.pc').textContent = x.value === '' ? '–' : pct((v / max) * 100); stat(); };
          x.onkeydown = (e) => { if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); inputs[i + 1]?.focus(); inputs[i + 1]?.select(); } if (e.key === 'ArrowUp') { e.preventDefault(); inputs[i - 1]?.focus(); } };
        });
        stat();
        g.querySelector('#msave').onclick = async () => {
          if (g.querySelector('.score.invalid')) return toast(`Some scores are outside 0–${max}`, 'error');
          try {
            const r = await saveOrQueue('/marks', { class_id: Number(c), subject_id: Number(s), assessment_id: Number(a), records: inputs.map((x) => ({ student_id: Number(x.dataset.id), score: x.value })) }, `marks ${className(c)}`);
            toast(r.queued ? 'Offline: marks stored on this device and will sync later' : `${r.saved} marks saved — awaiting approval`, r.queued ? 'info' : 'success');
            if (!r.queued) load();
          } catch (e) { toast(e.message, 'error'); }
        };
      };
      b.querySelectorAll('select').forEach((x) => (x.onchange = load));
      // Teachers: preselect a subject they actually teach in this class
      if (state.user.role === 'teacher' && !query.subject_id) {
        const { rows } = await api(`/r/teacher_assignments?teacher_id=${state.user.staff_id}`).catch(() => ({ rows: [] }));
        const pickFor = () => { const m = rows.find((r) => r.class_id == b.querySelector('#m-class').value); if (m) b.querySelector('#m-subj').value = m.subject_id; };
        pickFor(); b.querySelector('#m-class').addEventListener('change', pickFor);
      }
      load();
    }
    if (tab === 'results') {
      const classes = opt.myClasses();
      b.innerHTML = filterBar([sel('r-class', classes, query.class_id || classes[0]?.[0], t('Class')), sel('r-term', opt.terms(), currentTermId(), t('Term'))]) + '<div id="res"></div>';
      const load = async () => {
        const r = b.querySelector('#res'); r.innerHTML = loading();
        const c = b.querySelector('#r-class').value, tm = b.querySelector('#r-term').value;
        const d = await api(`/results?class_id=${c}&term_id=${tm}`);
        const rows = d.rows.map((x) => ({ ...x, ...Object.fromEntries(x.subjects.map((s) => [s.code, s.percent])) }));
        const passed = rows.filter((x) => x.average >= 50).length;
        r.innerHTML = `<div class="kpis">${kpi({ label: 'Class average', value: pct(rows.reduce((a2, x) => a2 + (x.average || 0), 0) / Math.max(1, rows.filter((x) => x.average != null).length)), ic: 'chart' })}${kpi({ label: 'Pass rate', value: pct((passed / Math.max(1, rows.length)) * 100), sub: `${passed} of ${rows.length} passed`, ic: 'check', tone: 't3' })}${kpi({ label: 'Top student', value: esc(rows.find((x) => x.position === 1)?.name || '–'), sub: pct(rows.find((x) => x.position === 1)?.average), ic: 'cap', tone: 't2' })}</div><div id="rt"></div>`;
        dataTable(r.querySelector('#rt'), { rows: rows.sort((x, y) => (x.position || 999) - (y.position || 999)), exportName: `results-${className(c)}`, onRow: (x) => go(`#/reportcard/${x.id}?term_id=${tm}`), columns: [
          { key: 'position', label: 'Pos', num: true }, { key: 'name', label: 'Student', html: (x) => `<b>${esc(x.name)}</b>${x.provisional ? ' ' + badge('Provisional', 'warn') : ''}` },
          ...d.subjects.map((s) => ({ key: s.code, label: s.code, num: true, html: (x) => (x[s.code] == null ? '–' : `<span class="${x[s.code] < 50 ? 'bad-text' : ''}">${Math.round(x[s.code])}</span>`) })),
          { key: 'average', label: 'Avg %', num: true, html: (x) => `<b>${pct(x.average)}</b>` }, { key: 'grade', html: (x) => `<span class="grade ${gradeClass(x.grade)}">${x.grade}</span>` }] });
      };
      b.querySelectorAll('select').forEach((x) => (x.onchange = load)); load();
    }
    if (tab === 'approve') {
      const rows = await api('/marks/pending');
      if (!rows.length) { b.innerHTML = empty('All marks are approved ✓', 'check'); return; }
      b.innerHTML = '<div id="ap"></div>';
      dataTable(b.querySelector('#ap'), { rows, columns: ['class_name', 'subject', 'term', 'assessment', { key: 'count', label: 'Marks', num: true }, { key: 'x', label: '', html: (r) => `<button class="btn primary sm" data-a='${JSON.stringify({ assessment_id: r.assessment_id, subject_id: r.subject_id, class_id: r.class_id })}'>Approve</button>` }] });
      b.querySelectorAll('[data-a]').forEach((x) => (x.onclick = async () => { const r = await api('/marks/approve', { method: 'POST', body: JSON.parse(x.dataset.a) }); toast(`${r.approved} marks approved`, 'success'); show('approve'); }));
    }
  };
  const first = query.tab && tabList.some((x) => x[0] === query.tab) ? query.tab : tabList[0][0];
  tabs(body.querySelector('#t'), tabList, first, show); show(first);
}

// ============ REPORT CARD ============
export async function reportCard(el, { id }, query) {
  const body = header(el, t('Report card'), { back: ['parent', 'student'].includes(state.user.role) ? '#/' : `#/students/${id}`, actions: `${sel('rc-term', opt.terms(), query.term_id || currentTermId(), t('Term'))}${btn(t('Print') + ' / PDF', 'print', { ic: 'print' })}` });
  const load = async () => {
    body.innerHTML = loading();
    const d = await api(`/reportcard?student_id=${id}&term_id=${el.querySelector('#rc-term').value}`);
    const r = d.result, s = d.student;
    body.innerHTML = `<article class="paper report-card">
      <header class="paper-head"><div class="crest">${icon('cap', 34)}</div><div><h2>${esc(d.school.school_name)}</h2><p>${esc(d.school.address)} · ${esc(d.school.phone)}</p><p class="motto">${esc(d.school.motto)}</p></div><div class="doc-title">STUDENT REPORT CARD<small>${esc(d.term.name)} · ${esc(d.term.year)}</small></div></header>
      <div class="paper-meta"><div><span>Name</span><b>${esc(s.first_name)} ${esc(s.last_name)}</b></div><div><span>Adm. no</span><b>${esc(s.adm_no)}</b></div><div><span>Class</span><b>${esc(s.class_name)}</b></div><div><span>Position</span><b>${r?.position || '–'} / ${d.classSize}</b></div><div><span>Attendance</span><b>${pct(d.attendance.rate)} (${d.attendance.absent || 0} absences)</b></div><div><span>Class teacher</span><b>${esc(s.class_teacher || '–')}</b></div></div>
      ${r ? `<table class="table paper-table"><thead><tr><th>Subject</th>${d.assessments.map((a) => `<th class="num">${esc(a.name)} /${a.max_score}</th>`).join('')}<th class="num">Total %</th><th>Grade</th><th>Remark</th></tr></thead><tbody>
        ${r.subjects.map((x) => `<tr><td>${esc(x.name)}</td>${x.parts.map((p) => `<td class="num">${p ?? '–'}</td>`).join('')}<td class="num"><b>${pct(x.percent)}</b></td><td><span class="grade ${gradeClass(x.grade)}">${x.grade}</span></td><td>${x.percent == null ? '' : x.percent >= 80 ? 'Excellent' : x.percent >= 70 ? 'Very good' : x.percent >= 60 ? 'Good' : x.percent >= 50 ? 'Fair' : 'Needs improvement'}</td></tr>`).join('')}
        </tbody><tfoot><tr><td><b>Average</b></td><td colspan="${d.assessments.length}"></td><td class="num"><b>${pct(r.average)}</b></td><td><span class="grade ${gradeClass(r.grade)}">${r.grade}</span></td><td>${r.average >= 50 ? 'PROMOTED / PASS' : 'Below pass mark'}</td></tr></tfoot></table>
        ${r.provisional ? '<p class="watermark">PROVISIONAL — some marks are awaiting approval</p>' : ''}` : empty('No marks for this term')}
      <div class="grade-key">Grading: A 80–100 · B 70–79 · C 60–69 · D 50–59 · E 40–49 · S 30–39 · F below 30</div>
      <div class="sign"><div><span></span>Class teacher</div><div><span></span>Head teacher</div><div><span></span>Parent / guardian</div></div>
      <footer class="paper-foot">Generated ${new Date().toLocaleString()} by ${esc(state.meta.school.school_name)} SMIS</footer>
    </article>`;
  };
  el.querySelector('#rc-term').onchange = load;
  el.querySelector('#print').onclick = () => window.print();
  load();
}

// ============ FINANCE ============
export function payModal(inv, done) {
  formModal({
    title: `Record payment · ${inv.student_name || ''}`, submitText: 'Record payment',
    fields: [
      { name: 'info', label: 'Invoice', readonly: true, full: true, default: `${inv.invoice_no} · ${inv.term_name} · balance ${money(inv.balance)}` },
      { name: 'amount', label: 'Amount received (RWF)', type: 'number', min: 1, required: true, default: Math.max(0, inv.balance) || '' },
      { name: 'method', label: 'Payment method', type: 'select', options: opt.list('Mobile Money', 'Bank', 'Cash'), required: true },
      { name: 'reference', label: 'Transaction reference', help: 'Required for bank & Mobile Money — prevents duplicate entries' },
      { name: 'paid_on', label: 'Date received', type: 'date', default: today(), required: true },
      { name: 'allow_overpay', label: 'Allow overpayment (record as credit)', type: 'checkbox', full: true },
    ],
    onSubmit: async (data, close) => {
      const r = await api('/payments', { method: 'POST', body: { ...data, invoice_id: inv.id } });
      close(); toast(`Payment recorded · receipt ${r.receipt_no}`, 'success');
      if (done) done(r);
      go(`#/receipt/${r.id}`);
    },
  });
}

export async function finance(el, _p, query) {
  const body = header(el, t('Finance'), { sub: 'Fees, invoices, receipts, expenses and budgets — every figure is calculated from recorded transactions' });
  body.innerHTML = '<div id="t"></div><div id="b"></div>';
  const w = can('finance', 'w');
  const show = async (tab) => {
    const b = body.querySelector('#b'); b.innerHTML = loading(); b.onclick = null;
    if (tab === 'overview') {
      b.innerHTML = filterBar([sel('fo-term', opt.terms(), currentTermId(), t('Term'))]) + '<div id="fo"></div>';
      const load = async () => {
        const s = await api(`/finance/summary?term_id=${b.querySelector('#fo-term').value}`);
        b.querySelector('#fo').innerHTML = `<div class="kpis">
          ${kpi({ label: 'Fees billed', value: money(s.billed), sub: `${s.invoices} invoices`, ic: 'clip' })}${kpi({ label: 'Collected', value: money(s.collected), sub: `${pct(s.rate)} collection rate`, ic: 'money', tone: 't3' })}
          ${kpi({ label: 'Outstanding', value: money(s.outstanding), sub: 'Arrears this term', ic: 'alert', tone: 'bad', href: '#/reports?r=arrears' })}${kpi({ label: 'Expenses (approved)', value: money(s.expenses), sub: `Net ${money(s.net)}`, ic: 'wallet', tone: 't2' })}</div>
          <div class="grid">${card('Collection by class', barChart(s.byClass.map((x) => ({ label: x.label, collected: x.paid, outstanding: x.billed - x.paid })), { series: ['collected', 'outstanding'], stacked: true }), { cls: 'span2' })}${card('Payment channels', donut(s.byMethod, { fmt: money }))}
          ${card('Monthly cash flow', barChart(s.cashflow, { series: ['income', 'expenses'] }), { cls: 'span2' })}${card('Budget use by category', `<ul class="list">${s.expByCat.map((x) => `<li><div style="flex:1"><b>${esc(x.label)}</b><small>${money(x.spent)} of ${money(x.budget)}</small>${meter(x.budget ? (x.spent / x.budget) * 100 : 0, { tone: x.spent > x.budget ? 'bad' : x.spent > x.budget * 0.85 ? 'warn' : 'good' })}</div></li>`).join('')}</ul>`)}</div>`;
      };
      b.querySelector('#fo-term').onchange = load; load();
    }
    if (tab === 'invoices') {
      b.innerHTML = filterBar([sel('fi-term', opt.terms(), currentTermId(), t('Term')), sel('fi-class', opt.classes(), '', t('Class'), { blank: 'All classes' }), sel('fi-status', opt.list('Unpaid', 'Partial', 'Paid'), '', 'Status', { blank: 'Any' }), w ? `<button class="btn ghost" id="gen">${icon('sync', 18)} Generate term invoices</button>` : '']) + '<div id="fi"></div>';
      const load = async () => {
        const qs = new URLSearchParams({ limit: 5000, term_id: b.querySelector('#fi-term').value, class_id: b.querySelector('#fi-class').value, status: b.querySelector('#fi-status').value, q: query.q || '' });
        const { rows } = await api(`/r/invoices?${qs}`);
        dataTable(b.querySelector('#fi'), { rows, exportName: 'invoices', onRow: (r) => go(`#/students/${r.student_id}`), columns: ['invoice_no', 'student_name', 'adm_no', 'class_name', { key: 'amount', label: 'Billed', num: true, html: (r) => money(r.amount) }, { key: 'paid', num: true, html: (r) => money(r.paid) }, { key: 'balance', num: true, html: (r) => `<b class="${r.balance > 0 ? 'bad-text' : ''}">${money(r.balance)}</b>` }, { key: 'status', html: (r) => badge(r.status, statusTone(r.status)) }, ...(w ? [{ key: 'x', label: '', html: (r) => (r.balance > 0 ? `<button class="btn primary sm" data-pay="${r.id}">${icon('money', 14)} Pay</button>` : '') }] : [])] });
        b.querySelector('#fi').onclick = (e) => { const x = e.target.closest('[data-pay]'); if (x) { e.stopPropagation(); payModal(rows.find((r) => r.id == x.dataset.pay), load); } };
      };
      b.querySelectorAll('select').forEach((x) => (x.onchange = load));
      const g = b.querySelector('#gen'); if (g) g.onclick = async () => { if (!(await confirmBox('Create invoices for every active student who does not yet have one for this term, using the fee structure?'))) return; try { const r = await api('/invoices/generate', { method: 'POST', body: { term_id: b.querySelector('#fi-term').value } }); toast(`${r.created} invoice(s) created`, 'success'); load(); } catch (e) { toast(e.message, 'error'); } };
      load();
    }
    if (tab === 'payments') {
      b.innerHTML = filterBar([sel('fp-method', opt.list('Mobile Money', 'Bank', 'Cash'), '', 'Method', { blank: 'All methods' })]) + '<div id="fp"></div>';
      const load = async () => {
        const { rows } = await api(`/r/payments?limit=5000&method=${encodeURIComponent(b.querySelector('#fp-method').value)}`);
        dataTable(b.querySelector('#fp'), { rows, exportName: 'payments', onRow: (r) => go(`#/receipt/${r.id}`), columns: ['receipt_no', { key: 'paid_on', label: 'Date', html: (r) => date(r.paid_on) }, 'student_name', 'invoice_no', 'method', 'reference', { key: 'amount', num: true, html: (r) => money(r.amount) }, { key: 'reversed', label: 'State', html: (r) => (r.reversed ? `${badge('Reversed', 'bad')}<small class="muted"> ${esc(r.reverse_reason)}</small>` : badge('Valid', 'good')) }, ...(w ? [{ key: 'x', label: '', html: (r) => (r.reversed ? '' : `<button class="btn ghost sm" data-rev="${r.id}">Reverse</button>`) }] : [])] });
        b.querySelector('#fp').onclick = async (e) => { const x = e.target.closest('[data-rev]'); if (!x) return; e.stopPropagation(); const reason = await confirmBox('Reversing keeps the record for audit but removes it from totals.', { danger: true, okText: 'Reverse payment', input: 'Reason for reversal' }); if (!reason) return; await api(`/payments/${x.dataset.rev}/reverse`, { method: 'POST', body: { reason } }); toast('Payment reversed', 'success'); load(); };
      };
      b.querySelector('#fp-method').onchange = load; load();
    }
    if (tab === 'fees') {
      const fields = [{ name: 'term_id', label: 'Term', type: 'select', options: opt.terms, required: true, default: currentTermId() }, { name: 'class_id', label: 'Class (empty = all classes)', type: 'select', options: opt.classes }, { name: 'item', label: 'Fee item', required: true, list: ['Tuition', 'Meals', 'Boarding', 'Transport', 'Development fund', 'Uniform', 'Exam fee'] }, { name: 'amount', label: 'Amount (RWF)', type: 'number', min: 0, required: true }];
      const { rows } = await api('/r/fee_structures?limit=1000');
      const edit = (v = {}) => formModal({ title: v.id ? 'Edit fee item' : 'Add fee item', fields, values: v, onSubmit: async (data, close) => { await api(v.id ? `/r/fee_structures/${v.id}` : '/r/fee_structures', { method: v.id ? 'PUT' : 'POST', body: data }); toast('Saved', 'success'); close(); show('fees'); } });
      dataTable(b, { rows, exportName: 'fee-structure', onRow: w ? edit : null, toolbar: w ? `<button class="btn primary sm" id="addfee">${icon('plus', 16)} ${t('Add')}</button>` : '', columns: ['term_name', 'class_name', 'item', { key: 'amount', num: true, html: (r) => money(r.amount) }] });
      const a = b.querySelector('#addfee'); if (a) a.onclick = () => edit();
    }
    if (tab === 'expenses') {
      const fields = [{ name: 'category', label: 'Category', required: true, list: state.meta.expenseCategories }, { name: 'description', label: 'Description', required: true }, { name: 'supplier', label: 'Supplier / payee' }, { name: 'amount', label: 'Amount (RWF)', type: 'number', min: 1, required: true }, { name: 'spent_on', label: 'Date', type: 'date', default: today(), required: true }];
      const edit = (v = {}) => formModal({ title: v.id ? 'Edit expense' : 'Record expense', fields, values: v, onSubmit: async (data, close) => { await api(v.id ? `/r/expenses/${v.id}` : '/r/expenses', { method: v.id ? 'PUT' : 'POST', body: data }); toast(v.id ? 'Expense updated' : 'Expense recorded — awaiting director approval', 'success'); close(); show('expenses'); } });
      b.innerHTML = filterBar([sel('fe-status', opt.list('Pending', 'Approved', 'Rejected'), '', 'Status', { blank: 'Any' })]) + '<div id="fe"></div>';
      const load = async () => {
        const { rows } = await api(`/r/expenses?limit=5000&status=${b.querySelector('#fe-status').value}`);
        const appr = can('approve_expense', 'w');
        dataTable(b.querySelector('#fe'), { rows, exportName: 'expenses', onRow: w ? (r) => (r.status === 'Pending' ? edit(r) : toast('Approved or rejected expenses are locked', 'info')) : null, toolbar: w ? `<button class="btn primary sm" id="addexp">${icon('plus', 16)} Record expense</button>` : '', columns: [{ key: 'spent_on', label: 'Date', html: (r) => date(r.spent_on) }, 'category', 'description', 'supplier', { key: 'amount', num: true, html: (r) => money(r.amount) }, { key: 'status', html: (r) => badge(r.status, statusTone(r.status)) }, ...(appr ? [{ key: 'x', label: '', html: (r) => (r.status === 'Pending' ? `<button class="btn primary sm" data-ex="${r.id}" data-a="approve">Approve</button> <button class="btn ghost sm" data-ex="${r.id}" data-a="reject">Reject</button>` : '') }] : [])] });
        const a = b.querySelector('#addexp'); if (a) a.onclick = () => edit();
        b.querySelector('#fe').onclick = async (e) => { const x = e.target.closest('[data-ex]'); if (!x) return; e.stopPropagation(); await api(`/expenses/${x.dataset.ex}/${x.dataset.a}`, { method: 'POST' }); toast(`Expense ${x.dataset.a}d`, 'success'); load(); };
      };
      b.querySelector('#fe-status').onchange = load; await load();
      if (query.new && w) edit();
    }
    if (tab === 'budgets') {
      const fields = [{ name: 'term_id', label: 'Term', type: 'select', options: opt.terms, required: true, default: currentTermId() }, { name: 'category', label: 'Category', required: true, list: state.meta.expenseCategories }, { name: 'amount', label: 'Budget (RWF)', type: 'number', min: 0, required: true }];
      const { rows } = await api('/r/budgets?limit=1000');
      const edit = (v = {}) => formModal({ title: v.id ? 'Edit budget line' : 'Add budget line', fields, values: v, onSubmit: async (data, close) => { await api(v.id ? `/r/budgets/${v.id}` : '/r/budgets', { method: v.id ? 'PUT' : 'POST', body: data }); toast('Saved', 'success'); close(); show('budgets'); } });
      dataTable(b, { rows, exportName: 'budgets', onRow: w ? edit : null, toolbar: `<a class="btn ghost sm" href="#/reports?r=budget">Budget vs actual ›</a>${w ? `<button class="btn primary sm" id="addb">${icon('plus', 16)} ${t('Add')}</button>` : ''}`, columns: ['term_name', 'category', { key: 'amount', num: true, html: (r) => money(r.amount) }] });
      const a = b.querySelector('#addb'); if (a) a.onclick = () => edit();
    }
  };
  const list = [['overview', 'Overview'], ['invoices', 'Invoices & fees'], ['payments', 'Receipts'], ['fees', 'Fee structure'], ['expenses', 'Expenses'], ['budgets', 'Budgets']];
  const first = query.tab || 'overview';
  tabs(body.querySelector('#t'), list, first, show); show(first);
}

export async function receipt(el, { id }) {
  const body = header(el, 'Payment receipt', { back: '#/finance?tab=payments', actions: btn(t('Print') + ' / PDF', 'print', { ic: 'print' }) });
  const d = await api(`/payments/${id}/receipt`);
  const p = d.payment;
  body.innerHTML = `<article class="paper receipt ${p.reversed ? 'void' : ''}">
    <header class="paper-head"><div class="crest">${icon('cap', 30)}</div><div><h2>${esc(d.school.school_name)}</h2><p>${esc(d.school.address)} · ${esc(d.school.phone)}</p></div><div class="doc-title">OFFICIAL RECEIPT<small>${esc(p.receipt_no)}</small></div></header>
    ${p.reversed ? `<p class="watermark">REVERSED — ${esc(p.reverse_reason)}</p>` : ''}
    <div class="paper-meta"><div><span>Received from</span><b>${esc(p.student_name)}</b></div><div><span>Adm. no / Class</span><b>${esc(p.adm_no)} · ${esc(p.class_name)}</b></div><div><span>Date</span><b>${date(p.paid_on)}</b></div><div><span>Invoice</span><b>${esc(p.invoice_no)} (${esc(p.term_name)})</b></div><div><span>Method</span><b>${esc(p.method)}</b></div><div><span>Reference</span><b>${esc(p.reference || '—')}</b></div></div>
    <div class="amount-box"><span>Amount paid</span><strong>${money(p.amount)}</strong><small>Invoice total ${money(p.invoice_amount)} · Remaining balance ${money(p.balance)}</small></div>
    <div class="sign"><div><span></span>Cashier: ${esc(p.cashier || '')}</div><div><span></span>School stamp</div></div>
    <footer class="paper-foot">Recorded ${esc(p.created_at)} UTC · Keep this receipt as proof of payment</footer></article>`;
  el.querySelector('#print').onclick = () => window.print();
}

// ============ PAYROLL ============
export async function payroll(el) {
  const w = can('payroll', 'w');
  const body = header(el, t('Payroll'), { sub: 'Monthly salary runs generated from staff records', actions: w ? btn('Generate payroll', 'gen', { ic: 'sync' }) : '' });
  body.innerHTML = '<div id="sum"></div><div id="pr"></div>';
  const load = async () => {
    const rep = await api('/reports/payroll');
    body.querySelector('#sum').innerHTML = `<div class="grid">${card('Net payroll by month', barChart([...rep.rows].reverse().map((r) => ({ label: r.month, value: r.net })), { height: 180 }), { cls: 'span2' })}${card('Latest run', rep.rows[0] ? `<div class="stat-row col"><div><b>${money(rep.rows[0].gross)}</b><small>Gross</small></div><div><b>${money(rep.rows[0].deductions)}</b><small>Deductions (PAYE, RSSB…)</small></div><div><b>${money(rep.rows[0].net)}</b><small>Net to staff · ${badge(rep.rows[0].status, statusTone(rep.rows[0].status))}</small></div></div>${can('finance', 'w') && rep.rows[0].status === 'Draft' ? `<button class="btn primary" id="markpaid">Mark ${rep.rows[0].month} as paid</button>` : ''}` : empty('No payroll yet'))}</div>`;
    const mp = body.querySelector('#markpaid'); if (mp) mp.onclick = async () => { await api('/payroll/mark-paid', { method: 'POST', body: { month: rep.rows[0].month } }); toast('Payroll marked as paid', 'success'); load(); };
    const { rows } = await api('/r/payroll?limit=5000');
    dataTable(body.querySelector('#pr'), { rows, exportName: 'payroll', columns: ['month', 'staff_no', 'staff_name', 'job_title', { key: 'gross', num: true, html: (r) => money(r.gross) }, { key: 'deductions', num: true, html: (r) => money(r.deductions) }, { key: 'net', num: true, html: (r) => `<b>${money(r.net)}</b>` }, { key: 'status', html: (r) => badge(r.status, statusTone(r.status)) }] });
  };
  const g = el.querySelector('#gen'); if (g) g.onclick = () => formModal({ title: 'Generate monthly payroll', fields: [{ name: 'month', label: 'Month', type: 'month', required: true, default: today().slice(0, 7) }, { name: 'deduction_rate', label: 'Deduction rate (0.18 = 18%)', type: 'number', step: '0.01', min: 0, max: 1, default: 0.18 }], onSubmit: async (data, close) => { const r = await api('/payroll/generate', { method: 'POST', body: data }); toast(`${r.created} payslip(s) created as Draft`, 'success'); close(); load(); } });
  load();
}

// ============ GENERIC CRUD PAGES ============
function crudPage({ title, sub, res, perm, columns, fields, filters = [], exportName, rowActions, onRowsLoaded }) {
  return async (el, _p, query) => {
    const w = can(perm, 'w');
    const body = header(el, title, { sub, actions: w ? btn(t('Add'), 'add', { ic: 'plus' }) : '' });
    body.innerHTML = (filters.length ? filterBar(filters.map((f) => sel(`flt-${f.key}`, f.options(), query[f.key] || '', f.label, { blank: 'All' }))) : '') + '<div id="tbl"></div>';
    const fs = typeof fields === 'function' ? await fields() : fields;
    const edit = (v = {}) => formModal({ title: v.id ? `${t('Edit')} — ${title}` : `${t('Add')} — ${title}`, fields: fs, values: v, onSubmit: async (data, close) => { await api(v.id ? `/r/${res}/${v.id}` : `/r/${res}`, { method: v.id ? 'PUT' : 'POST', body: data }); toast('Saved', 'success'); close(); load(); } });
    const load = async () => {
      const qs = new URLSearchParams({ limit: 5000 }); filters.forEach((f) => qs.set(f.key, body.querySelector(`#flt-${f.key}`).value));
      const { rows } = await api(`/r/${res}?${qs}`);
      if (onRowsLoaded) onRowsLoaded(rows, body);
      dataTable(body.querySelector('#tbl'), { rows, exportName: exportName || res, onRow: w ? edit : null, columns: [...columns, ...(rowActions ? [{ key: 'act', label: '', html: rowActions }] : [])] });
    };
    body.querySelectorAll('.filters select').forEach((s) => (s.onchange = load));
    body.querySelector('#tbl').addEventListener('click', async (e) => {
      const x = e.target.closest('[data-action]'); if (!x) return; e.stopPropagation();
      if (x.dataset.action === 'return') { const r = await api(`/loans/${x.dataset.id}/return`, { method: 'POST' }); toast(r.fine ? `Returned ${r.daysLate} day(s) late — fine ${money(r.fine)}` : 'Book returned on time', r.fine ? 'info' : 'success'); load(); }
      if (x.dataset.action === 'delete') { if (!(await confirmBox('Delete this record?', { danger: true, okText: t('Delete') }))) return; try { await api(`/r/${res}/${x.dataset.id}`, { method: 'DELETE' }); toast('Deleted', 'success'); load(); } catch (er) { toast(er.message, 'error'); } }
      if (x.dataset.action === 'reset') { const pw = await confirmBox('Set a new temporary password for this user. They will be signed out everywhere.', { okText: 'Reset password', input: 'New password (min 8 characters)' }); if (!pw) return; try { await api(`/users/${x.dataset.id}/reset`, { method: 'POST', body: { password: pw } }); toast('Password reset', 'success'); } catch (er) { toast(er.message, 'error'); } }
    });
    const a = el.querySelector('#add'); if (a) a.onclick = () => edit();
    await load();
    if (query.new && w) edit();
  };
}

export async function library(el, p, query) {
  const body = header(el, t('Library'), { sub: 'Catalogue, borrowing, returns and overdue fines (100 RWF/day)' });
  body.innerHTML = '<div id="t"></div><div id="b"></div>';
  const show = async (tab) => {
    const b = body.querySelector('#b');
    const sub = document.createElement('div'); b.replaceChildren(sub);
    if (tab === 'books') await crudPage({ title: 'Books', res: 'books', perm: 'library', columns: ['title', 'author', 'category', 'isbn', 'shelf', { key: 'copies', num: true }, { key: 'available', num: true, html: (r) => badge(`${r.available} available`, r.available > 0 ? 'good' : 'bad') }], fields: [{ name: 'title', label: 'Title', required: true, full: true }, { name: 'author', label: 'Author' }, { name: 'isbn', label: 'ISBN' }, { name: 'category', label: 'Category', list: ['Textbook', 'Literature', 'History', 'ICT', 'Reference'] }, { name: 'copies', label: 'Copies', type: 'number', min: 1, default: 1 }, { name: 'shelf', label: 'Shelf' }] })(sub, p, query);
    if (tab === 'loans') await crudPage({ title: 'Loans', res: 'book_loans', perm: 'library', filters: [{ key: 'state', label: 'State', options: () => opt.list('On loan', 'Overdue', 'Returned') }], columns: ['title', 'student_name', 'adm_no', { key: 'borrowed_on', html: (r) => date(r.borrowed_on) }, { key: 'due_on', html: (r) => date(r.due_on) }, { key: 'state', html: (r) => badge(r.state, statusTone(r.state)) }, { key: 'fine', num: true, html: (r) => (r.fine ? money(r.fine) : '') }], rowActions: (r) => (!r.returned_on && can('library', 'w') ? `<button class="btn ghost sm" data-action="return" data-id="${r.id}">Return</button>` : ''),
      fields: async () => [{ name: 'book_id', label: 'Book', type: 'select', required: true, options: (await api('/r/books?limit=5000')).rows.filter((x) => x.available > 0).map((x) => [x.id, `${x.title} (${x.available} left)`]), full: true }, { name: 'student_id', label: 'Student', type: 'select', required: true, options: await studentOptions(), full: true }, { name: 'borrowed_on', label: 'Borrowed on', type: 'date', default: today() }, { name: 'due_on', label: 'Due on', type: 'date', default: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10) }] })(sub, p, query);
    sub.querySelector('.page-head h1')?.remove();
  };
  const first = query.tab || 'books';
  tabs(body.querySelector('#t'), [['books', 'Catalogue'], ['loans', 'Loans & returns']], first, show); show(first);
}

export const inventory = crudPage({
  title: 'Inventory', sub: 'Assets, supplies, stock levels and suppliers', res: 'inventory', perm: 'inventory', filters: [{ key: 'category', label: 'Category', options: () => opt.list('ICT', 'Furniture', 'Stationery', 'Food', 'Boarding', 'Science', 'Sports') }],
  columns: ['item', 'category', { key: 'quantity', num: true, html: (r) => `${num(r.quantity)} ${esc(r.unit || '')} ${r.quantity < 20 ? badge('Low', 'warn') : ''}` }, 'location', { key: 'condition', html: (r) => badge(r.condition, r.condition === 'Good' ? 'good' : r.condition === 'Fair' ? 'warn' : 'bad') }, 'supplier', { key: 'unit_cost', num: true, html: (r) => money(r.unit_cost) }, { key: 'total_value', label: 'Value', num: true, html: (r) => money(r.total_value) }],
  fields: [{ name: 'item', label: 'Item', required: true }, { name: 'category', label: 'Category', list: ['ICT', 'Furniture', 'Stationery', 'Food', 'Boarding', 'Science', 'Sports'] }, { name: 'quantity', label: 'Quantity', type: 'number', min: 0, required: true }, { name: 'unit', label: 'Unit', list: ['pcs', 'kg', 'boxes', 'litres', 'reams'] }, { name: 'location', label: 'Location' }, { name: 'condition', label: 'Condition', type: 'select', options: opt.list('Good', 'Fair', 'Poor', 'Broken') }, { name: 'supplier', label: 'Supplier' }, { name: 'unit_cost', label: 'Unit cost (RWF)', type: 'number', min: 0 }],
});

export const discipline = crudPage({
  title: 'Discipline', sub: 'Incidents and follow-up actions — visible only to authorised staff', res: 'discipline', perm: 'discipline', filters: [{ key: 'status', label: 'Status', options: () => opt.list('Open', 'Closed') }],
  columns: [{ key: 'date', html: (r) => date(r.date) }, { key: 'student_name', label: 'Student', html: (r) => `<a href="#/students/${r.student_id}">${esc(r.student_name)}</a>` }, 'class_name', 'incident', 'action_taken', { key: 'status', html: (r) => badge(r.status, statusTone(r.status)) }],
  fields: async () => [{ name: 'student_id', label: 'Student', type: 'select', required: true, options: await studentOptions(), full: true }, { name: 'date', label: 'Date', type: 'date', default: today(), required: true }, { name: 'status', label: 'Status', type: 'select', options: opt.list('Open', 'Closed'), default: 'Open' }, { name: 'incident', label: 'Incident', type: 'textarea', required: true, full: true }, { name: 'action_taken', label: 'Action taken / follow-up', type: 'textarea', full: true }],
});

export const users = crudPage({
  title: 'Users & access', sub: 'Accounts and role-based permissions. Deactivate accounts immediately when staff leave.', res: 'users', perm: 'users', filters: [{ key: 'role', label: 'Role', options: opt.roles }],
  columns: ['username', 'full_name', { key: 'role', html: (r) => badge(state.meta.roles[r.role]?.label || r.role, 'info') }, { key: 'last_login', html: (r) => (r.last_login ? date(r.last_login) : 'Never') }, { key: 'active', label: 'Status', html: (r) => (r.active ? badge('Active', 'good') : badge('Disabled', 'bad')) }],
  rowActions: (r) => `<button class="btn ghost sm" data-action="reset" data-id="${r.id}">Reset password</button>${r.active ? ` <button class="btn ghost sm" data-action="delete" data-id="${r.id}">Disable</button>` : ''}`,
  fields: async () => [{ name: 'username', label: 'Username', required: true }, { name: 'full_name', label: 'Full name', required: true }, { name: 'role', label: 'Role', type: 'select', options: opt.roles, required: true }, { name: 'password', label: 'Initial password (new users only)', type: 'password', help: 'At least 8 characters. Ask the user to change it after first sign-in.' }, { name: 'staff_id', label: 'Linked staff record', type: 'select', options: opt.staff }, { name: 'student_id', label: 'Linked student (student accounts)', type: 'select', options: await studentOptions() }, { name: 'active', label: 'Account active', type: 'checkbox', default: 1 }],
});

export const audit = crudPage({
  title: 'Audit log', sub: 'Every sign-in, change, approval, export and backup is recorded here', res: 'audit_logs', perm: 'audit', filters: [{ key: 'action', label: 'Action', options: () => opt.list('login', 'login_failed', 'create', 'update', 'delete', 'deactivate', 'payment', 'payment_reverse', 'marks_entry', 'marks_approve', 'attendance', 'export', 'backup', 'view_profile') }],
  columns: [{ key: 'at', label: 'When (UTC)' }, 'username', { key: 'action', html: (r) => badge(label(r.action), /fail|reverse|delete/.test(r.action) ? 'bad' : 'info') }, 'entity', 'entity_id', { key: 'details', html: (r) => `<code class="small">${esc((r.details || '').slice(0, 120))}</code>` }, 'ip'],
});

// ============ ANNOUNCEMENTS ============
export async function announcements(el, _p, query) {
  const w = can('announcements', 'w');
  const body = header(el, t('Announcements'), { sub: 'Notices for staff, parents and students', actions: w ? btn('New announcement', 'add', { ic: 'plus' }) : '' });
  const fields = [{ name: 'title', label: 'Title', required: true, full: true }, { name: 'audience', label: 'Audience', type: 'select', options: opt.list('All', 'Staff', 'Parents', 'Students'), required: true }, { name: 'pinned', label: 'Pin to top', type: 'checkbox' }, { name: 'body', label: 'Message', type: 'textarea', full: true, required: true }];
  const edit = (v = {}) => formModal({ title: v.id ? 'Edit announcement' : 'New announcement', fields, values: v, onSubmit: async (data, close) => { await api(v.id ? `/r/announcements/${v.id}` : '/r/announcements', { method: v.id ? 'PUT' : 'POST', body: data }); toast('Announcement published', 'success'); close(); load(); } });
  const load = async () => {
    const { rows } = await api('/r/announcements?limit=200');
    body.innerHTML = rows.length ? `<div class="feed">${rows.map((a) => `<article class="card post"><header><span class="avatar">${icon('megaphone', 18)}</span><div><h3>${esc(a.title)} ${a.pinned ? badge('Pinned', 'info') : ''}</h3><small class="muted">${esc(a.author || 'School office')} · ${date(a.created_at)} · to ${esc(a.audience)}</small></div>${w ? `<button class="icon-btn" data-e="${a.id}" title="${t('Edit')}">${icon('cog', 16)}</button><button class="icon-btn danger" data-d="${a.id}" title="${t('Delete')}">${icon('x', 16)}</button>` : ''}</header><p>${esc(a.body).replace(/\n/g, '<br>')}</p></article>`).join('')}</div>` : empty('No announcements yet', 'megaphone');
    body.querySelectorAll('[data-e]').forEach((x) => (x.onclick = () => edit(rows.find((r) => r.id == x.dataset.e))));
    body.querySelectorAll('[data-d]').forEach((x) => (x.onclick = async () => { if (await confirmBox('Delete this announcement?', { danger: true })) { await api(`/r/announcements/${x.dataset.d}`, { method: 'DELETE' }); load(); } }));
  };
  const a = el.querySelector('#add'); if (a) a.onclick = () => edit();
  await load();
  if (query.new && w) edit();
}

// ============ CALENDAR ============
export async function calendar(el, _p, query) {
  const w = can('calendar', 'w');
  const body = header(el, t('Calendar'), { sub: 'Terms, holidays, exams, meetings and events', actions: w ? btn('Add event', 'add', { ic: 'plus' }) : '' });
  let cur = query.m ? new Date(query.m + '-01T00:00') : new Date(); cur.setDate(1);
  const fields = [{ name: 'title', label: 'Title', required: true, full: true }, { name: 'date', label: 'Date', type: 'date', required: true, default: today() }, { name: 'end_date', label: 'End date (optional)', type: 'date' }, { name: 'category', label: 'Type', type: 'select', options: opt.list('Event', 'Exam', 'Meeting', 'Holiday', 'Term', 'Sports'), required: true }, { name: 'description', label: 'Details', type: 'textarea', full: true }];
  const edit = (v = {}) => formModal({ title: v.id ? 'Edit event' : 'Add event', fields, values: v, onSubmit: async (data, close) => { await api(v.id ? `/r/events/${v.id}` : '/r/events', { method: v.id ? 'PUT' : 'POST', body: data }); toast('Saved', 'success'); close(); render(); } });
  let events = [];
  const render = async () => {
    events = (await api('/r/events?limit=1000')).rows;
    const y = cur.getFullYear(), m = cur.getMonth();
    const startDow = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
    const iso = (d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const on = (ds) => events.filter((e) => e.date <= ds && (e.end_date || e.date) >= ds);
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push('<div class="cal-cell blank"></div>');
    for (let d = 1; d <= days; d++) { const ds = iso(d); cells.push(`<div class="cal-cell ${ds === today() ? 'today' : ''}" data-date="${ds}"><span class="cal-d">${d}</span>${on(ds).map((e) => `<button class="cal-ev ${e.category.toLowerCase()}" data-ev="${e.id}" title="${esc(e.title)}">${esc(e.title)}</button>`).join('')}</div>`); }
    const upcoming = events.filter((e) => (e.end_date || e.date) >= today()).slice(0, 8);
    body.innerHTML = `<div class="grid cal-layout"><section class="card span2"><header class="card-head"><button class="icon-btn" id="prev" aria-label="Previous month">‹</button><h3>${cur.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</h3><button class="icon-btn" id="next" aria-label="Next month">›</button><button class="btn ghost sm" id="tod">Today</button></header>
      <div class="cal"><div class="cal-dow">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((x) => `<span>${x}</span>`).join('')}</div><div class="cal-grid">${cells.join('')}</div></div></section>
      ${card('Upcoming', upcoming.length ? `<ul class="list">${upcoming.map((e) => { const dt = new Date(e.date + 'T00:00'); return `<li><span class="date-chip"><b>${dt.getDate()}</b>${dt.toLocaleString(undefined, { month: 'short' })}</span><div><b>${esc(e.title)}</b><small>${badge(e.category, 'info')} ${esc(e.description || '')}</small></div></li>`; }).join('')}</ul>` : empty('Nothing scheduled', 'calendar'))}</div>`;
    body.querySelector('#prev').onclick = () => { cur.setMonth(cur.getMonth() - 1); render(); };
    body.querySelector('#next').onclick = () => { cur.setMonth(cur.getMonth() + 1); render(); };
    body.querySelector('#tod').onclick = () => { cur = new Date(); cur.setDate(1); render(); };
    body.querySelectorAll('[data-ev]').forEach((x) => (x.onclick = (e) => { e.stopPropagation(); const ev = events.find((r) => r.id == x.dataset.ev); if (w) edit(ev); else modal({ title: ev.title, body: `<p>${badge(ev.category, 'info')} ${date(ev.date)}${ev.end_date ? ` → ${date(ev.end_date)}` : ''}</p><p>${esc(ev.description || '')}</p>` }); }));
    if (w) body.querySelectorAll('.cal-cell[data-date]').forEach((c) => (c.ondblclick = () => edit({ date: c.dataset.date })));
  };
  const a = el.querySelector('#add'); if (a) a.onclick = () => edit();
  render();
}

// ============ REPORTS ============
export async function reports(el, _p, query) {
  const body = header(el, t('Reports'), { sub: 'Management reports from live records — filter, compare, export to CSV/Excel or print to PDF' });
  const list = await api('/reports');
  if (!list.length) { body.innerHTML = empty('No reports available for your role', 'chart'); return; }
  const groups = { Academic: ['academic', 'subjects', 'enrollment'], Attendance: ['attendance', 'absentees'], Finance: ['fees', 'arrears', 'budget', 'cashflow'], Staff: ['staff', 'payroll'], Executive: ['executive'] };
  const active = query.r && list.some((x) => x.key === query.r) ? query.r : list[0].key;
  body.innerHTML = `<div class="report-layout"><nav class="report-nav card">${Object.entries(groups).map(([g, keys]) => { const items = list.filter((x) => keys.includes(x.key)); return items.length ? `<h4>${g}</h4>${items.map((x) => `<a href="#/reports?r=${x.key}" class="${x.key === active ? 'active' : ''}">${esc(x.title)}</a>`).join('')}` : ''; }).join('')}</nav><div id="rep"></div></div>`;
  const rep = body.querySelector('#rep');
  const needs = { academic: ['term', 'class'], subjects: ['term', 'class'], fees: ['term'], arrears: ['term', 'class'], budget: ['term'], attendance: ['range', 'class'], executive: ['term'] }[active] || [];
  const f = [];
  if (needs.includes('term')) f.push(sel('rp-term', opt.terms(), query.term_id || currentTermId(), t('Term')));
  if (needs.includes('class')) f.push(sel('rp-class', opt.classes(), query.class_id || '', t('Class'), { blank: 'All classes' }));
  if (needs.includes('range')) f.push(inp('rp-from', 'date', query.from || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), 'From'), inp('rp-to', 'date', query.to || today(), 'To'));
  rep.innerHTML = `${filterBar([...f, `<div class="spacer"></div><button class="btn ghost" id="rp-print">${icon('print', 18)} ${t('Print')} / PDF</button>`])}<div id="rp-out"></div>`;
  const load = async () => {
    const out = rep.querySelector('#rp-out'); out.innerHTML = loading();
    const qs = new URLSearchParams();
    if (needs.includes('term')) qs.set('term_id', rep.querySelector('#rp-term').value);
    if (needs.includes('class')) qs.set('class_id', rep.querySelector('#rp-class').value);
    if (needs.includes('range')) { qs.set('from', rep.querySelector('#rp-from').value); qs.set('to', rep.querySelector('#rp-to').value); }
    const d = await api(`/reports/${active}?${qs}`);
    const moneyCols = new Set(d.money || []);
    const cols = d.columns.map((c) => ({ key: c, label: label(c), num: typeof d.rows[0]?.[c] === 'number', html: (r) => (moneyCols.has(c) || (c === 'value' && r.money) ? money(r[c]) : /rate|used|average/.test(c) && typeof r[c] === 'number' ? `${pct(r[c])} ${c !== 'average' ? meter(r[c]) : ''}` : esc(r[c] ?? '–')), export: (r) => r[c] }));
    out.innerHTML = `<article class="card report-sheet"><header class="report-title"><div><h2>${esc(d.title)}</h2><p class="muted">${esc(d.school)} · ${esc(d.subtitle || '')} · generated ${new Date(d.generated).toLocaleString()}</p></div></header>
      ${d.chart ? `<div class="report-chart">${barChart(d.rows, { labelKey: d.chart.label, series: d.chart.series, max: d.chart.max, stacked: d.chart.stacked, unit: d.chart.max === 100 ? '%' : '' })}</div>` : ''}<div id="rp-tbl"></div></article>`;
    dataTable(out.querySelector('#rp-tbl'), { rows: d.rows, columns: cols, pageSize: 100, exportName: `${active}-report` });
    out.querySelectorAll('[data-exp]').forEach((x) => x.addEventListener('click', () => api(`/reports/${active}?${qs}&export=${x.dataset.exp}`).catch(() => {})));
  };
  rep.querySelectorAll('.filters select, .filters input').forEach((x) => (x.onchange = load));
  rep.querySelector('#rp-print').onclick = () => window.print();
  load();
}

// ============ SETTINGS ============
export async function settings(el) {
  const body = header(el, t('Settings'), { sub: 'School profile, terms, security, backups and connecting other computers' });
  const isAdmin = can('settings');
  const sys = isAdmin ? await api('/system').catch(() => null) : null;
  const s = state.meta.school;
  body.innerHTML = `<div class="grid">
    ${card('My account', `<p><b>${esc(state.user.full_name)}</b><br><span class="muted">${esc(state.user.username)} · ${esc(state.user.roleLabel)}</span></p><button class="btn ghost" id="pw">${icon('shield', 18)} Change password</button>`)}
    ${card('Appearance & language', `<div class="form-grid"><label class="field"><span>Theme</span><select id="theme"><option value="">Follow system</option><option value="light">Light</option><option value="dark">Dark</option></select></label><label class="field"><span>Language</span><select id="lang"><option value="en">English</option><option value="rw">Kinyarwanda</option><option value="fr">Français</option></select></label><label class="field full"><span>Text size</span><input type="range" id="fsize" min="14" max="19" step="1"></label></div>`)}
    ${card('Install as a computer app', `<p class="muted">SMIS can run as a desktop app on Windows, macOS, Linux, Android and iPad — with offline support for attendance and marks.</p><button class="btn primary" id="install" ${window.__installPrompt ? '' : 'hidden'}>${icon('install', 18)} Install SMIS app</button><p class="small muted" id="install-hint">${window.matchMedia('(display-mode: standalone)').matches ? '✓ You are using the installed app.' : 'In Chrome or Edge: menu ⋮ → “Install SMIS”. On phones: Share → “Add to Home screen”. For a full offline desktop server, use the Windows desktop build (see README).'}</p>`)}
    ${isAdmin ? card('School profile', `<form class="form-grid" id="school">${[['school_name', 'School name'], ['motto', 'Motto'], ['address', 'Address'], ['phone', 'Phone'], ['currency', 'Currency'], ['pass_mark', 'Pass mark (%)']].map(([k, l]) => `<label class="field"><span>${l}</span><input name="${k}" value="${esc(s[k] || '')}" ${can('settings', 'w') ? '' : 'disabled'}></label>`).join('')}<label class="field"><span>Current term</span><select name="current_term_id" ${can('settings', 'w') ? '' : 'disabled'}>${opt.terms().map(([k, l]) => `<option value="${k}" ${k === currentTermId() ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>${can('settings', 'w') ? `<div class="full"><button class="btn primary">${t('Save')}</button></div>` : ''}</form>`, { cls: 'span2' }) : ''}
    ${sys ? card('Hybrid network access', `<p class="muted">Other office computers, teachers' laptops and phones on the school Wi-Fi can open SMIS in a browser at:</p><ul class="list">${sys.lanAddresses.map((a) => `<li><span class="avatar sm">${icon('wifi', 16)}</span><div><b class="mono">http://${a}:${sys.port}</b><small>School network address</small></div></li>`).join('') || '<li>No network connection detected</li>'}</ul><p class="small muted">For access from anywhere (parents at home), host this same server online behind HTTPS — see README “Online deployment”.</p>`) : ''}
    ${sys ? card('Backup & system', `<div class="stat-row col"><div><b>${(sys.dbSize / 1048576).toFixed(2)} MB</b><small>Database</small></div><div><b>${esc(sys.node)}</b><small>Runtime · ${esc(sys.platform)}</small></div><div><b>${Math.round(sys.uptime / 60)} min</b><small>Uptime</small></div></div>${can('settings', 'w') ? `<button class="btn primary" id="backup">${icon('download', 18)} Download backup</button><p class="small muted">Store backups encrypted, off-site, and test restoring them every term.</p>` : ''}`) : ''}
    ${card('Data protection checklist', `<ul class="checklist">${['HTTPS for all online connections', 'Strong passwords + session timeout (45 min idle)', 'Role-based access to every module', 'Audit log of changes, exports and backups', 'Financial records reversed, never deleted', 'Encrypted, tested backups', 'Privacy notice & parental consent (Rwanda DPP Law No. 058/2021)', 'Disable accounts the day staff leave'].map((x, i) => `<li class="${i < 6 ? 'done' : ''}">${icon(i < 6 ? 'check' : 'alert', 16)} ${esc(x)}</li>`).join('')}</ul>`)}
  </div>`;
  const th = body.querySelector('#theme'); th.value = localStorage.getItem('smis.theme') || ''; th.onchange = () => { window.smisSetTheme(th.value); };
  const lg = body.querySelector('#lang'); lg.value = state.lang; lg.onchange = () => window.smisSetLang(lg.value);
  const fz = body.querySelector('#fsize'); fz.value = parseInt(getComputedStyle(document.documentElement).fontSize, 10); fz.oninput = () => window.smisSetFont(fz.value);
  body.querySelector('#pw').onclick = () => formModal({ title: 'Change password', fields: [{ name: 'current', label: 'Current password', type: 'password', required: true, full: true }, { name: 'next', label: 'New password (min 8 characters)', type: 'password', required: true, full: true }], onSubmit: async (d, close) => { await api('/password', { method: 'POST', body: d }); toast('Password changed. Other sessions were signed out.', 'success'); close(); } });
  const ins = body.querySelector('#install'); if (ins) ins.onclick = async () => { window.__installPrompt.prompt(); await window.__installPrompt.userChoice; window.__installPrompt = null; ins.hidden = true; };
  const sf = body.querySelector('#school'); if (sf) sf.onsubmit = async (e) => { e.preventDefault(); await api('/settings', { method: 'PUT', body: Object.fromEntries(new FormData(sf)) }); await refreshMeta(); toast('Settings saved', 'success'); };
  const bk = body.querySelector('#backup'); if (bk) bk.onclick = async () => { const res = await api('/backup', { raw: true }); const blob = await res.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `smis-backup-${today()}.db`; a.click(); toast('Backup downloaded', 'success'); };
}

export { exportRows };
