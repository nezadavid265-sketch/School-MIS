// SMIS backend: zero-dependency HTTP server (Node 22.5+ built-ins only).
// Serves the web app + REST API. Used by the browser/PWA, the LAN, and the Electron desktop shell.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { open, tx } = require('./db');
const sec = require('./security');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const SESSION_MS = 8 * 3600e3;      // absolute max
const IDLE_MS = 45 * 60e3;          // sliding idle timeout

function createServer({ dbFile = process.env.SMIS_DB || path.join(ROOT, 'data', 'smis.db') } = {}) {
  const db = open(dbFile);
  const q = (sql, ...p) => db.prepare(sql).all(...p);
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  const setting = (k) => (one('SELECT value FROM school_settings WHERE key=?', k) || {}).value;
  const currentTerm = () => one('SELECT * FROM terms WHERE is_current=1') || one('SELECT * FROM terms ORDER BY id DESC LIMIT 1');
  const today = () => new Date().toISOString().slice(0, 10);

  function audit(user, action, entity, entityId, details, ip) {
    run('INSERT INTO audit_logs(user_id,username,action,entity,entity_id,details,ip) VALUES(?,?,?,?,?,?,?)',
      user ? user.id : null, user ? user.username : null, action, entity || null, entityId == null ? null : String(entityId),
      details ? JSON.stringify(details).slice(0, 2000) : null, ip || null);
  }

  const grade = (p) => (p >= 80 ? 'A' : p >= 70 ? 'B' : p >= 60 ? 'C' : p >= 50 ? 'D' : p >= 40 ? 'E' : p >= 30 ? 'S' : 'F');

  // Classes a teacher is attached to (subject teacher or class teacher)
  const teacherClasses = (u) => q(`SELECT class_id id FROM teacher_assignments WHERE teacher_id=? UNION SELECT id FROM classes WHERE class_teacher_id=?`,
    u.staff_id || -1, u.staff_id || -1).map((x) => x.id);
  // Students a user may see; null = no restriction
  function visibleStudents(u) {
    if (u.role === 'teacher') { const c = teacherClasses(u); return q(`SELECT id FROM students WHERE class_id IN (${c.map(() => '?').join(',') || 'NULL'})`, ...c).map((x) => x.id); }
    if (u.role === 'parent') return q('SELECT student_id id FROM guardian_links WHERE user_id=?', u.id).map((x) => x.id);
    if (u.role === 'student') return [u.student_id];
    return null;
  }
  const mayViewStudent = (u, id) => { const v = visibleStudents(u); return v === null ? sec.can(u.role, 'students') || sec.can(u.role, 'finance') : v.includes(Number(id)); };

  // ---------------- Generic resources ----------------
  const R = {
    students: {
      perm: 'students', table: 'students', search: ['first_name', 'last_name', 'adm_no', 'guardian_name'], filters: ['class_id', 'status', 'gender', 'boarding'],
      cols: ['adm_no', 'first_name', 'last_name', 'gender', 'dob', 'class_id', 'status', 'guardian_name', 'guardian_phone', 'guardian_email', 'address', 'emergency_contact', 'boarding', 'enrolled_on', 'notes'],
      select: `SELECT s.*, c.name class_name FROM students s LEFT JOIN classes c ON c.id=s.class_id`, order: 'last_name, first_name',
      scope: (u) => { const v = visibleStudents(u); return v === null ? null : { sql: `id IN (${v.map(() => '?').join(',') || 'NULL'})`, params: v }; },
      softDelete: { status: 'Withdrawn' },
      beforeCreate: (d) => { if (!d.adm_no) d.adm_no = `${new Date().getFullYear()}-${String((one('SELECT MAX(id) m FROM students').m || 0) + 1).padStart(4, '0')}`; if (!d.enrolled_on) d.enrolled_on = today(); },
    },
    staff: {
      perm: 'staff', table: 'staff', search: ['first_name', 'last_name', 'staff_no', 'job_title', 'department'], filters: ['department', 'status', 'job_title'],
      cols: ['staff_no', 'first_name', 'last_name', 'gender', 'job_title', 'department', 'phone', 'email', 'qualification', 'salary', 'hired_on', 'contract_end', 'status'],
      select: 'SELECT * FROM staff', order: 'last_name', hidden: { salary: 'salaries' }, softDelete: { status: 'Left' },
      beforeCreate: (d) => { if (!d.staff_no) d.staff_no = `STF${String((one('SELECT MAX(id) m FROM staff').m || 0) + 1).padStart(3, '0')}`; },
    },
    classes: {
      perm: 'academics', table: 'classes', search: ['name'], cols: ['name', 'level', 'stream', 'class_teacher_id', 'capacity'],
      select: `SELECT c.*, st.first_name||' '||st.last_name teacher_name, (SELECT COUNT(*) FROM students s WHERE s.class_id=c.id AND s.status='Active') enrolled
               FROM classes c LEFT JOIN staff st ON st.id=c.class_teacher_id`, order: 'name',
    },
    subjects: { perm: 'academics', table: 'subjects', search: ['name', 'code'], cols: ['code', 'name', 'department'], select: 'SELECT * FROM subjects', order: 'name' },
    teacher_assignments: {
      perm: 'academics', table: 'teacher_assignments', filters: ['class_id', 'teacher_id', 'subject_id'], cols: ['class_id', 'subject_id', 'teacher_id'],
      select: `SELECT ta.*, c.name class_name, sj.name subject_name, st.first_name||' '||st.last_name teacher_name FROM teacher_assignments ta
               JOIN classes c ON c.id=ta.class_id JOIN subjects sj ON sj.id=ta.subject_id LEFT JOIN staff st ON st.id=ta.teacher_id`, order: 'class_name, subject_name',
    },
    terms: { perm: 'academics', table: 'terms', cols: ['year_id', 'name', 'start_date', 'end_date', 'is_current'], select: `SELECT t.*, y.name year_name FROM terms t JOIN academic_years y ON y.id=t.year_id`, order: 'id' },
    assessments: { perm: 'academics', table: 'assessments', filters: ['term_id'], cols: ['term_id', 'name', 'max_score'], select: `SELECT a.*, t.name term_name FROM assessments a JOIN terms t ON t.id=a.term_id`, order: 'term_id, id' },
    fee_structures: {
      perm: 'finance', table: 'fee_structures', filters: ['term_id', 'class_id'], cols: ['term_id', 'class_id', 'item', 'amount'],
      select: `SELECT f.*, t.name term_name, COALESCE(c.name,'All classes') class_name FROM fee_structures f JOIN terms t ON t.id=f.term_id LEFT JOIN classes c ON c.id=f.class_id`, order: 'term_id, class_name',
    },
    invoices: {
      perm: 'finance', table: 'invoices', readOnly: true, search: ['invoice_no', 'student_name', 'adm_no'], filters: ['term_id', 'class_id', 'student_id', 'status'],
      select: `SELECT i.*, s.first_name||' '||s.last_name student_name, s.adm_no, s.class_id, c.name class_name, t.name term_name,
               COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id=i.id AND p.reversed=0),0) paid,
               i.amount-COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id=i.id AND p.reversed=0),0) balance,
               CASE WHEN i.amount-COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id=i.id AND p.reversed=0),0) <= 0 THEN 'Paid'
                    WHEN COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id=i.id AND p.reversed=0),0) > 0 THEN 'Partial' ELSE 'Unpaid' END status
               FROM invoices i JOIN students s ON s.id=i.student_id LEFT JOIN classes c ON c.id=s.class_id JOIN terms t ON t.id=i.term_id`, order: 'invoice_no DESC',
      scope: (u) => { const v = visibleStudents(u); return v === null ? null : { sql: `student_id IN (${v.map(() => '?').join(',') || 'NULL'})`, params: v }; },
    },
    payments: {
      perm: 'finance', table: 'payments', readOnly: true, search: ['receipt_no', 'reference', 'student_name', 'adm_no'], filters: ['method', 'student_id', 'reversed', 'invoice_id'],
      select: `SELECT p.*, s.first_name||' '||s.last_name student_name, s.adm_no, i.invoice_no, u.username recorded_by_name FROM payments p
               JOIN students s ON s.id=p.student_id JOIN invoices i ON i.id=p.invoice_id LEFT JOIN users u ON u.id=p.recorded_by`, order: 'paid_on DESC, id DESC',
      scope: (u) => { const v = visibleStudents(u); return v === null ? null : { sql: `student_id IN (${v.map(() => '?').join(',') || 'NULL'})`, params: v }; },
    },
    expenses: {
      perm: 'finance', table: 'expenses', search: ['category', 'description', 'supplier'], filters: ['category', 'status'], cols: ['category', 'description', 'supplier', 'amount', 'spent_on'],
      select: `SELECT e.*, u.username recorded_by_name FROM expenses e LEFT JOIN users u ON u.id=e.recorded_by`, order: 'spent_on DESC', noDelete: true,
      beforeCreate: (d, u) => { d.recorded_by = u.id; d.status = 'Pending'; },
    },
    budgets: { perm: 'finance', table: 'budgets', filters: ['term_id'], cols: ['term_id', 'category', 'amount'], select: `SELECT b.*, t.name term_name FROM budgets b JOIN terms t ON t.id=b.term_id`, order: 'term_id, category' },
    payroll: {
      perm: 'payroll', table: 'payroll', readOnly: true, filters: ['month', 'status'], search: ['staff_name'],
      select: `SELECT p.*, s.first_name||' '||s.last_name staff_name, s.staff_no, s.job_title FROM payroll p JOIN staff s ON s.id=p.staff_id`, order: 'month DESC, staff_name',
    },
    leave_requests: {
      perm: 'leave', table: 'leave_requests', filters: ['status', 'staff_id'], cols: ['staff_id', 'leave_type', 'start_date', 'end_date', 'reason'],
      select: `SELECT l.*, s.first_name||' '||s.last_name staff_name, s.job_title FROM leave_requests l JOIN staff s ON s.id=l.staff_id`, order: 'created_at DESC',
      scope: (u) => (['hr', 'headteacher', 'director'].includes(u.role) ? null : { sql: 'staff_id=?', params: [u.staff_id || -1] }),
    },
    books: { perm: 'library', table: 'books', search: ['title', 'author', 'isbn'], filters: ['category'], cols: ['isbn', 'title', 'author', 'category', 'copies', 'shelf'],
      select: `SELECT b.*, b.copies-(SELECT COUNT(*) FROM book_loans l WHERE l.book_id=b.id AND l.returned_on IS NULL) available FROM books b`, order: 'title' },
    book_loans: {
      perm: 'library', table: 'book_loans', search: ['title', 'student_name'], filters: ['state', 'student_id'], cols: ['book_id', 'student_id', 'borrowed_on', 'due_on'],
      select: `SELECT l.*, b.title, s.first_name||' '||s.last_name student_name, s.adm_no,
               CASE WHEN l.returned_on IS NOT NULL THEN 'Returned' WHEN l.due_on < date('now') THEN 'Overdue' ELSE 'On loan' END state
               FROM book_loans l JOIN books b ON b.id=l.book_id JOIN students s ON s.id=l.student_id`, order: 'borrowed_on DESC',
      scope: (u) => (u.role === 'student' ? { sql: 'student_id=?', params: [u.student_id] } : null),
      beforeCreate: (d) => { if (!d.borrowed_on) d.borrowed_on = today(); if (!d.due_on) d.due_on = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10); },
    },
    inventory: { perm: 'inventory', table: 'inventory', search: ['item', 'supplier', 'location'], filters: ['category', 'condition'], cols: ['item', 'category', 'quantity', 'unit', 'location', 'condition', 'supplier', 'unit_cost'], select: 'SELECT *, quantity*unit_cost total_value FROM inventory', order: 'category, item' },
    discipline: {
      perm: 'discipline', table: 'discipline', search: ['student_name', 'incident'], filters: ['status', 'student_id'], cols: ['student_id', 'date', 'incident', 'action_taken', 'status'],
      select: `SELECT d.*, s.first_name||' '||s.last_name student_name, s.adm_no, c.name class_name FROM discipline d JOIN students s ON s.id=d.student_id LEFT JOIN classes c ON c.id=s.class_id`, order: 'date DESC',
      scope: (u) => { const v = visibleStudents(u); return v === null ? null : { sql: `student_id IN (${v.map(() => '?').join(',') || 'NULL'})`, params: v }; },
      beforeCreate: (d, u) => { d.recorded_by = u.id; },
    },
    announcements: {
      perm: 'announcements', table: 'announcements', search: ['title', 'body'], filters: ['audience'], cols: ['title', 'body', 'audience', 'pinned'],
      select: `SELECT a.*, u.full_name author FROM announcements a LEFT JOIN users u ON u.id=a.created_by`, order: 'pinned DESC, created_at DESC',
      scope: (u) => (u.role === 'parent' ? { sql: "audience IN ('All','Parents')", params: [] } : u.role === 'student' ? { sql: "audience IN ('All','Students')", params: [] } : null),
      beforeCreate: (d, u) => { d.created_by = u.id; },
    },
    events: { perm: 'calendar', table: 'events', search: ['title'], filters: ['category'], cols: ['title', 'date', 'end_date', 'category', 'description'], select: 'SELECT * FROM events', order: 'date' },
    users: {
      perm: 'users', table: 'users', search: ['username', 'full_name'], filters: ['role', 'active'], cols: ['username', 'role', 'full_name', 'staff_id', 'student_id', 'active'],
      select: 'SELECT id, username, role, full_name, staff_id, student_id, active, last_login, created_at FROM users', order: 'role, username', softDelete: { active: 0 },
      beforeCreate: (d) => { if (!sec.ROLES[d.role]) throw httpErr(400, 'Unknown role'); d.password_hash = sec.hashPassword(d.password || 'ChangeMe!2026'); },
    },
    audit_logs: { perm: 'audit', table: 'audit_logs', readOnly: true, search: ['username', 'action', 'entity', 'details'], filters: ['action', 'entity'], select: 'SELECT * FROM audit_logs', order: 'id DESC' },
  };

  function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }

  function listResource(res, u, query) {
    const def = R[res];
    const where = []; const params = [];
    const sc = def.scope && def.scope(u);
    if (sc) { where.push(sc.sql); params.push(...sc.params); }
    for (const f of def.filters || []) if (query[f] !== undefined && query[f] !== '') { where.push(`${f} = ?`); params.push(query[f]); }
    if (query.q && def.search) { where.push(`(${def.search.map((c) => `${c} LIKE ?`).join(' OR ')})`); def.search.forEach(() => params.push(`%${query.q}%`)); }
    const limit = Math.min(Number(query.limit) || 500, 5000);
    const total = one(`SELECT COUNT(*) n FROM (${def.select}) t ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, ...params).n;
    let rows = q(`SELECT * FROM (${def.select}) t ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${def.order || 'id'} LIMIT ${limit} OFFSET ${Number(query.offset) || 0}`, ...params);
    rows = rows.map((r) => stripHidden(def, u, r));
    return { rows, total };
  }
  function stripHidden(def, u, row) {
    if (!def.hidden) return row;
    const r = { ...row };
    for (const [col, perm] of Object.entries(def.hidden)) if (!sec.can(u.role, perm)) delete r[col];
    return r;
  }
  function pickCols(def, u, body) {
    const d = {};
    for (const c of def.cols) if (body[c] !== undefined) {
      if (def.hidden && def.hidden[c] && !sec.can(u.role, def.hidden[c], 'w')) continue;
      d[c] = body[c] === '' ? null : body[c];
    }
    return d;
  }
  function inScope(def, u, id) {
    const sc = def.scope && def.scope(u);
    if (!sc) return true;
    return !!one(`SELECT 1 FROM (${def.select}) t WHERE id=? AND ${sc.sql}`, id, ...sc.params);
  }

  // ---------------- Domain helpers ----------------
  function studentTermResults(classId, termId) {
    const subjects = q('SELECT s.id, s.code, s.name FROM subjects s JOIN teacher_assignments ta ON ta.subject_id=s.id AND ta.class_id=? ORDER BY s.name', classId);
    const assessments = q('SELECT * FROM assessments WHERE term_id=? ORDER BY id', termId);
    const maxTotal = assessments.reduce((a, b) => a + b.max_score, 0);
    const students = q("SELECT id, adm_no, first_name||' '||last_name name, gender FROM students WHERE class_id=? AND status='Active' ORDER BY last_name, first_name", classId);
    const marks = q(`SELECT m.student_id, m.subject_id, m.assessment_id, m.score, m.approved FROM marks m JOIN assessments a ON a.id=m.assessment_id
                     JOIN students s ON s.id=m.student_id WHERE a.term_id=? AND s.class_id=?`, termId, classId);
    const idx = {};
    for (const m of marks) ((idx[m.student_id] ||= {})[m.subject_id] ||= {})[m.assessment_id] = m;
    const rows = students.map((st) => {
      let sum = 0, count = 0, provisional = false;
      const subj = subjects.map((sj) => {
        const ms = (idx[st.id] || {})[sj.id] || {};
        const parts = assessments.map((a) => (ms[a.id] ? ms[a.id].score : null));
        if (assessments.some((a) => ms[a.id] && !ms[a.id].approved)) provisional = true;
        const got = parts.filter((x) => x != null);
        const avail = assessments.filter((a) => ms[a.id]).reduce((s, a) => s + a.max_score, 0);
        const pct = avail ? (got.reduce((a, b) => a + b, 0) / avail) * 100 : null;
        if (pct != null) { sum += pct; count++; }
        return { subject_id: sj.id, code: sj.code, name: sj.name, parts, percent: pct == null ? null : Math.round(pct * 10) / 10, grade: pct == null ? '-' : grade(pct) };
      });
      const average = count ? Math.round((sum / count) * 10) / 10 : null;
      return { ...st, subjects: subj, average, grade: average == null ? '-' : grade(average), provisional };
    });
    const ranked = rows.filter((r) => r.average != null).sort((a, b) => b.average - a.average);
    ranked.forEach((r, i) => { r.position = i > 0 && ranked[i - 1].average === r.average ? ranked[i - 1].position : i + 1; });
    return { subjects, assessments, maxTotal, rows, classSize: rows.length };
  }

  function attendanceStats(where, params) {
    return one(`SELECT COUNT(*) total, SUM(a.status='P') present, SUM(a.status='A') absent, SUM(a.status='L') late, SUM(a.status='E') excused,
      ROUND(100.0*SUM(a.status IN ('P','L'))/MAX(COUNT(*),1),1) rate FROM student_attendance a JOIN students s ON s.id=a.student_id WHERE ${where}`, ...params);
  }

  function chronicAbsentees(days = 10, threshold = 3, studentFilter) {
    const from = one(`SELECT MIN(date) d FROM (SELECT DISTINCT date FROM student_attendance ORDER BY date DESC LIMIT ?)`, days).d || today();
    let rows = q(`SELECT s.id, s.adm_no, s.first_name||' '||s.last_name name, c.name class_name, s.guardian_phone, COUNT(*) absences
      FROM student_attendance a JOIN students s ON s.id=a.student_id LEFT JOIN classes c ON c.id=s.class_id
      WHERE a.status='A' AND a.date>=? GROUP BY s.id HAVING COUNT(*)>=? ORDER BY absences DESC`, from, threshold);
    if (studentFilter) rows = rows.filter((r) => studentFilter.includes(r.id));
    return rows;
  }

  function financeSummary(termId) {
    const t = one('SELECT * FROM terms WHERE id=?', termId);
    const billed = one('SELECT COALESCE(SUM(amount),0) v, COUNT(*) n FROM invoices WHERE term_id=?', termId);
    const paid = one('SELECT COALESCE(SUM(p.amount),0) v FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.term_id=? AND p.reversed=0', termId).v;
    const expenses = one("SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE status='Approved' AND spent_on BETWEEN ? AND ?", t.start_date, t.end_date).v;
    const byMethod = q(`SELECT method label, SUM(p.amount) value FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.term_id=? AND p.reversed=0 GROUP BY method ORDER BY value DESC`, termId);
    const byClass = q(`SELECT c.name label, SUM(i.amount) billed, COALESCE(SUM(pp.paid),0) paid FROM invoices i JOIN students s ON s.id=i.student_id JOIN classes c ON c.id=s.class_id
      LEFT JOIN (SELECT invoice_id, SUM(amount) paid FROM payments WHERE reversed=0 GROUP BY invoice_id) pp ON pp.invoice_id=i.id WHERE i.term_id=? GROUP BY c.id ORDER BY c.name`, termId);
    const expByCat = q(`SELECT e.category label, SUM(e.amount) spent, COALESCE((SELECT amount FROM budgets b WHERE b.term_id=? AND b.category=e.category),0) budget
      FROM expenses e WHERE e.status='Approved' AND e.spent_on BETWEEN ? AND ? GROUP BY e.category ORDER BY spent DESC`, termId, t.start_date, t.end_date);
    return { term: t, billed: billed.v, invoices: billed.n, collected: paid, outstanding: billed.v - paid, rate: billed.v ? Math.round((paid / billed.v) * 1000) / 10 : 0, expenses, net: paid - expenses, byMethod, byClass, expByCat };
  }

  function cashflow(months = 10) {
    return q(`WITH RECURSIVE m(i, mo) AS (SELECT 0, strftime('%Y-%m','now') UNION ALL SELECT i+1, strftime('%Y-%m', date('now','start of month', '-'||(i+1)||' months')) FROM m WHERE i < ?)
      SELECT mo label, COALESCE((SELECT SUM(amount) FROM payments WHERE reversed=0 AND substr(paid_on,1,7)=mo),0) income,
             COALESCE((SELECT SUM(amount) FROM expenses WHERE status='Approved' AND substr(spent_on,1,7)=mo),0) expenses FROM m ORDER BY mo`, months - 1);
  }

  // ---------------- Reports ----------------
  const fmt = (n) => Math.round(n || 0);
  const REPORTS = {
    enrollment: { perm: 'students', title: 'Enrollment by class', run: () => {
      const rows = q(`SELECT c.name class, SUM(s.gender='M') male, SUM(s.gender='F') female, SUM(s.boarding='Boarding') boarding, COUNT(s.id) total, c.capacity
        FROM classes c LEFT JOIN students s ON s.class_id=c.id AND s.status='Active' GROUP BY c.id ORDER BY c.name`);
      return { columns: ['class', 'male', 'female', 'boarding', 'total', 'capacity'], rows, chart: { type: 'bar', label: 'class', series: ['male', 'female'] } };
    } },
    attendance: { perm: 'attendance', title: 'Attendance by class', run: (p) => {
      const from = p.from || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), to = p.to || today();
      const rows = q(`SELECT c.name class, COUNT(*) records, SUM(a.status='P') present, SUM(a.status='L') late, SUM(a.status='A') absent, SUM(a.status='E') excused,
        ROUND(100.0*SUM(a.status IN ('P','L'))/COUNT(*),1) rate FROM student_attendance a JOIN students s ON s.id=a.student_id JOIN classes c ON c.id=s.class_id
        WHERE a.date BETWEEN ? AND ? ${p.class_id ? 'AND c.id=?' : ''} GROUP BY c.id ORDER BY c.name`, from, to, ...(p.class_id ? [p.class_id] : []));
      return { subtitle: `${from} to ${to}`, columns: ['class', 'records', 'present', 'late', 'absent', 'excused', 'rate'], rows, chart: { type: 'bar', label: 'class', series: ['rate'], max: 100 } };
    } },
    absentees: { perm: 'attendance', title: 'Repeated absences (last 10 school days)', run: () => ({ columns: ['adm_no', 'name', 'class_name', 'absences', 'guardian_phone'], rows: chronicAbsentees() }) },
    academic: { perm: 'academics', title: 'Academic performance by class', run: (p) => {
      const termId = p.term_id || currentTerm().id;
      const rows = q('SELECT id, name FROM classes ORDER BY name').filter((c) => !p.class_id || c.id == p.class_id).map((c) => {
        const r = studentTermResults(c.id, termId).rows.filter((x) => x.average != null);
        const avg = r.length ? r.reduce((a, b) => a + b.average, 0) / r.length : 0;
        const pass = r.filter((x) => x.average >= Number(setting('pass_mark') || 50)).length;
        return { class: c.name, students: r.length, average: Math.round(avg * 10) / 10, passed: pass, pass_rate: r.length ? Math.round((pass / r.length) * 1000) / 10 : 0, top_student: r.sort((a, b) => b.average - a.average)[0]?.name || '-' };
      });
      return { subtitle: (one('SELECT name FROM terms WHERE id=?', termId) || {}).name, columns: ['class', 'students', 'average', 'passed', 'pass_rate', 'top_student'], rows, chart: { type: 'bar', label: 'class', series: ['average', 'pass_rate'], max: 100 } };
    } },
    subjects: { perm: 'academics', title: 'Subject performance', run: (p) => {
      const termId = p.term_id || currentTerm().id;
      const rows = q(`SELECT sj.name subject, COUNT(DISTINCT m.student_id) students, ROUND(AVG(pct),1) average, ROUND(100.0*SUM(pct>=50)/COUNT(*),1) pass_rate FROM (
          SELECT m.student_id, m.subject_id, 100.0*SUM(m.score)/SUM(a.max_score) pct FROM marks m JOIN assessments a ON a.id=m.assessment_id JOIN students s ON s.id=m.student_id
          WHERE a.term_id=? AND m.approved=1 ${p.class_id ? 'AND s.class_id=?' : ''} GROUP BY m.student_id, m.subject_id) m JOIN subjects sj ON sj.id=m.subject_id GROUP BY sj.id ORDER BY average DESC`,
        termId, ...(p.class_id ? [p.class_id] : []));
      return { columns: ['subject', 'students', 'average', 'pass_rate'], rows, chart: { type: 'bar', label: 'subject', series: ['average'], max: 100 } };
    } },
    fees: { perm: 'finance', title: 'Fee collection by class', run: (p) => {
      const s = financeSummary(p.term_id || currentTerm().id);
      const rows = s.byClass.map((r) => ({ class: r.label, billed: r.billed, collected: r.paid, outstanding: r.billed - r.paid, rate: r.billed ? Math.round((r.paid / r.billed) * 1000) / 10 : 0 }));
      return { subtitle: s.term.name, columns: ['class', 'billed', 'collected', 'outstanding', 'rate'], money: ['billed', 'collected', 'outstanding'], rows, chart: { type: 'bar', label: 'class', series: ['collected', 'outstanding'], stacked: true } };
    } },
    arrears: { perm: 'finance', title: 'Outstanding balances', run: (p) => {
      const termId = p.term_id || currentTerm().id;
      const rows = listResource('invoices', { role: 'bursar' }, { term_id: termId, limit: 5000, ...(p.class_id ? { class_id: p.class_id } : {}) }).rows
        .filter((r) => r.balance > 0).sort((a, b) => b.balance - a.balance)
        .map((r) => ({ adm_no: r.adm_no, student: r.student_name, class: r.class_name, invoice: r.invoice_no, billed: r.amount, paid: r.paid, balance: r.balance }));
      return { columns: ['adm_no', 'student', 'class', 'invoice', 'billed', 'paid', 'balance'], money: ['billed', 'paid', 'balance'], rows };
    } },
    budget: { perm: 'finance', title: 'Budget vs actual expenses', run: (p) => {
      const s = financeSummary(p.term_id || currentTerm().id);
      const cats = new Set([...s.expByCat.map((x) => x.label), ...q('SELECT category FROM budgets WHERE term_id=?', s.term.id).map((x) => x.category)]);
      const rows = [...cats].map((c) => {
        const e = s.expByCat.find((x) => x.label === c);
        const budget = (one('SELECT amount FROM budgets WHERE term_id=? AND category=?', s.term.id, c) || {}).amount || 0;
        const spent = e ? e.spent : 0;
        return { category: c, budget, spent, variance: budget - spent, used: budget ? Math.round((spent / budget) * 1000) / 10 : 0 };
      });
      return { subtitle: s.term.name, columns: ['category', 'budget', 'spent', 'variance', 'used'], money: ['budget', 'spent', 'variance'], rows, chart: { type: 'bar', label: 'category', series: ['budget', 'spent'] } };
    } },
    cashflow: { perm: 'finance', title: 'Monthly cash flow', run: () => {
      const rows = cashflow(10).map((r) => ({ month: r.label, income: r.income, expenses: r.expenses, net: r.income - r.expenses }));
      return { columns: ['month', 'income', 'expenses', 'net'], money: ['income', 'expenses', 'net'], rows, chart: { type: 'bar', label: 'month', series: ['income', 'expenses'] } };
    } },
    staff: { perm: 'staff', title: 'Staff by department', run: () => {
      const rows = q(`SELECT s.department, COUNT(*) staff, SUM(s.gender='F') female,
        ROUND(100.0*(SELECT SUM(a.status IN ('P','L')) FROM staff_attendance a JOIN staff x ON x.id=a.staff_id WHERE x.department=s.department)/
          MAX((SELECT COUNT(*) FROM staff_attendance a JOIN staff x ON x.id=a.staff_id WHERE x.department=s.department),1),1) attendance_rate,
        SUM(s.contract_end <= date('now','+90 days')) contracts_expiring
        FROM staff s WHERE s.status='Active' GROUP BY s.department ORDER BY staff DESC`);
      return { columns: ['department', 'staff', 'female', 'attendance_rate', 'contracts_expiring'], rows, chart: { type: 'bar', label: 'department', series: ['staff'] } };
    } },
    payroll: { perm: 'payroll', title: 'Payroll summary by month', run: () => {
      const rows = q('SELECT month, COUNT(*) staff, SUM(gross) gross, SUM(deductions) deductions, SUM(net) net, MIN(status) status FROM payroll GROUP BY month ORDER BY month DESC');
      return { columns: ['month', 'staff', 'gross', 'deductions', 'net', 'status'], money: ['gross', 'deductions', 'net'], rows, chart: { type: 'bar', label: 'month', series: ['net'] } };
    } },
    executive: { perm: 'reports', title: 'Executive summary', run: (p) => {
      const termId = p.term_id || currentTerm().id;
      const f = financeSummary(termId);
      const att = attendanceStats("a.date >= date('now','-30 days')", []);
      const acad = REPORTS.academic.run({ term_id: termId }).rows;
      const pass = acad.reduce((a, b) => a + b.passed, 0), tot = acad.reduce((a, b) => a + b.students, 0);
      const rows = [
        { indicator: 'Active students', value: one("SELECT COUNT(*) n FROM students WHERE status='Active'").n },
        { indicator: 'Active staff', value: one("SELECT COUNT(*) n FROM staff WHERE status='Active'").n },
        { indicator: 'Student attendance (30 days)', value: `${att.rate}%` },
        { indicator: 'Academic pass rate', value: tot ? `${Math.round((pass / tot) * 1000) / 10}%` : '-' },
        { indicator: 'Fees billed', value: fmt(f.billed), money: true },
        { indicator: 'Fees collected', value: fmt(f.collected), money: true },
        { indicator: 'Collection rate', value: `${f.rate}%` },
        { indicator: 'Outstanding balances', value: fmt(f.outstanding), money: true },
        { indicator: 'Approved expenses (term)', value: fmt(f.expenses), money: true },
        { indicator: 'Net (collected − expenses)', value: fmt(f.net), money: true },
        { indicator: 'Students with repeated absences', value: chronicAbsentees().length },
        { indicator: 'Pending leave requests', value: one("SELECT COUNT(*) n FROM leave_requests WHERE status='Pending'").n },
        { indicator: 'Expenses awaiting approval', value: one("SELECT COUNT(*) n FROM expenses WHERE status='Pending'").n },
      ];
      return { subtitle: f.term.name, columns: ['indicator', 'value'], rows };
    } },
  };

  // ---------------- HTTP plumbing ----------------
  function send(res, status, body, headers = {}) {
    const isBuf = Buffer.isBuffer(body);
    const data = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': isBuf ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', ...headers });
    res.end(data);
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > 2e6) { reject(httpErr(413, 'Payload too large')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { if (!chunks.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(httpErr(400, 'Invalid JSON')); } });
      req.on('error', reject);
    });
  }
  const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=').map(decodeURIComponent)).filter((x) => x[0]));
  function getUser(req) {
    const token = cookies(req).sid;
    if (!token) return null;
    const s = one('SELECT * FROM sessions WHERE token=?', token);
    if (!s || s.expires_at < Date.now()) { if (s) run('DELETE FROM sessions WHERE token=?', token); return null; }
    const u = one('SELECT id, username, role, full_name, staff_id, student_id, active FROM users WHERE id=?', s.user_id);
    if (!u || !u.active) return null;
    run('UPDATE sessions SET expires_at=? WHERE token=?', Date.now() + IDLE_MS, token);
    u.token = token;
    return u;
  }
  const need = (u, mod, mode = 'r') => { if (!sec.can(u.role, mod, mode)) throw httpErr(403, 'You do not have permission for this action'); };

  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
  const SEC_HEADERS = {
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };

  function serveStatic(req, res, pathname) {
    let file = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' || file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=300', ...SEC_HEADERS });
    fs.createReadStream(file).pipe(res);
  }

  // ---------------- Routes ----------------
  async function api(req, res, url) {
    const ip = req.socket.remoteAddress;
    const p = url.pathname.replace(/^\/api/, '');
    const query = Object.fromEntries(url.searchParams);
    const method = req.method;
    const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readBody(req) : {};

    if (p === '/health') return send(res, 200, { ok: true, time: new Date().toISOString() });

    if (p === '/login' && method === 'POST') {
      const key = `${ip}|${String(body.username || '').toLowerCase()}`;
      if (sec.throttled(key)) throw httpErr(429, 'Too many failed attempts. Try again in 10 minutes.');
      const u = one('SELECT * FROM users WHERE username=? COLLATE NOCASE', String(body.username || ''));
      if (!u || !u.active || !sec.verifyPassword(String(body.password || ''), u.password_hash)) {
        sec.recordFail(key); audit(null, 'login_failed', 'users', null, { username: body.username }, ip);
        throw httpErr(401, 'Incorrect username or password');
      }
      sec.clearFails(key);
      const token = sec.newToken();
      run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
      run('INSERT INTO sessions(token,user_id,expires_at,ip) VALUES(?,?,?,?)', token, u.id, Date.now() + IDLE_MS, ip);
      run('UPDATE users SET last_login=CURRENT_TIMESTAMP WHERE id=?', u.id);
      audit(u, 'login', 'users', u.id, null, ip);
      const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
      return send(res, 200, { ok: true }, { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}` });
    }

    const u = getUser(req);
    if (!u) throw httpErr(401, 'Please sign in');

    // CSRF defence: state-changing requests must come from our own origin
    if (method !== 'GET' && req.headers['x-requested-with'] !== 'smis') throw httpErr(403, 'Bad request origin');

    if (p === '/logout' && method === 'POST') { run('DELETE FROM sessions WHERE token=?', u.token); audit(u, 'logout', 'users', u.id, null, ip); return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); }

    if (p === '/me') {
      const perms = Object.fromEntries(Object.keys(sec.PERMS).map((m) => [m, { r: sec.can(u.role, m), w: sec.can(u.role, m, 'w') }]));
      return send(res, 200, { user: { id: u.id, username: u.username, role: u.role, roleLabel: sec.ROLES[u.role].label, full_name: u.full_name, staff_id: u.staff_id, student_id: u.student_id }, perms });
    }

    if (p === '/password' && method === 'POST') {
      const full = one('SELECT password_hash FROM users WHERE id=?', u.id);
      if (!sec.verifyPassword(String(body.current || ''), full.password_hash)) throw httpErr(400, 'Current password is incorrect');
      if (String(body.next || '').length < 8) throw httpErr(400, 'New password must have at least 8 characters');
      run('UPDATE users SET password_hash=? WHERE id=?', sec.hashPassword(body.next), u.id);
      run('DELETE FROM sessions WHERE user_id=? AND token<>?', u.id, u.token);
      audit(u, 'password_change', 'users', u.id, null, ip);
      return send(res, 200, { ok: true });
    }

    if (p === '/meta') {
      const staffRows = sec.can(u.role, 'staff') || sec.can(u.role, 'academics') || sec.can(u.role, 'leave')
        ? q("SELECT id, staff_no, first_name||' '||last_name name, job_title, department FROM staff WHERE status='Active' ORDER BY last_name") : [];
      return send(res, 200, {
        school: Object.fromEntries(q('SELECT key, value FROM school_settings').map((r) => [r.key, r.value])),
        classes: q('SELECT id, name, level, stream FROM classes ORDER BY name'),
        subjects: q('SELECT id, code, name FROM subjects ORDER BY name'),
        terms: q('SELECT t.id, t.name, y.name year, t.start_date, t.end_date, t.is_current FROM terms t JOIN academic_years y ON y.id=t.year_id ORDER BY t.id'),
        assessments: q('SELECT * FROM assessments ORDER BY term_id, id'),
        currentTerm: currentTerm(), staff: staffRows, roles: sec.ROLES,
        myClasses: u.role === 'teacher' ? teacherClasses(u) : null,
        expenseCategories: q('SELECT DISTINCT category FROM expenses UNION SELECT DISTINCT category FROM budgets ORDER BY 1').map((r) => r.category),
      });
    }

    // Generic CRUD: /r/:resource[/:id]
    let m = p.match(/^\/r\/([a-z_]+)(?:\/(\d+))?$/);
    if (m && R[m[1]]) {
      const [, res_, idStr] = m; const def = R[res_]; const id = idStr && Number(idStr);
      if (method === 'GET') {
        need(u, def.perm);
        if (id) { if (!inScope(def, u, id)) throw httpErr(404, 'Not found'); const row = one(`SELECT * FROM (${def.select}) t WHERE id=?`, id); if (!row) throw httpErr(404, 'Not found'); return send(res, 200, stripHidden(def, u, row)); }
        return send(res, 200, listResource(res_, u, query));
      }
      if (def.readOnly) throw httpErr(405, 'This record type cannot be edited directly');
      need(u, def.perm, 'w');
      if (method === 'POST') {
        const d = pickCols(def, u, body);
        if (def.beforeCreate) def.beforeCreate(d, u, body);
        const keys = Object.keys(d);
        const r = run(`INSERT INTO ${def.table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, ...keys.map((k) => d[k]));
        const { password_hash, ...logged } = d;
        audit(u, 'create', res_, r.lastInsertRowid, logged, ip);
        return send(res, 201, { id: Number(r.lastInsertRowid) });
      }
      if (!id) throw httpErr(400, 'Missing id');
      if (!inScope(def, u, id)) throw httpErr(404, 'Not found');
      const before = one(`SELECT * FROM ${def.table} WHERE id=?`, id);
      if (!before) throw httpErr(404, 'Not found');
      if (method === 'PUT') {
        if (res_ === 'expenses' && before.status !== 'Pending') throw httpErr(409, 'Approved or rejected expenses are locked');
        const d = pickCols(def, u, body);
        const keys = Object.keys(d);
        if (keys.length) run(`UPDATE ${def.table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...keys.map((k) => d[k]), id);
        const changes = Object.fromEntries(keys.filter((k) => String(before[k] ?? '') !== String(d[k] ?? '')).map((k) => [k, { from: before[k], to: d[k] }]));
        audit(u, 'update', res_, id, changes, ip);
        return send(res, 200, { ok: true });
      }
      if (method === 'DELETE') {
        if (def.noDelete) throw httpErr(409, 'Financial records cannot be deleted. Reject or reverse them instead.');
        if (def.softDelete) { const [k, v] = Object.entries(def.softDelete)[0]; run(`UPDATE ${def.table} SET ${k}=? WHERE id=?`, v, id); audit(u, 'deactivate', res_, id, { [k]: v }, ip); }
        else { try { run(`DELETE FROM ${def.table} WHERE id=?`, id); } catch { throw httpErr(409, 'This record is in use by other records and cannot be deleted'); } audit(u, 'delete', res_, id, before, ip); }
        return send(res, 200, { ok: true });
      }
    }

    if (p === '/dashboard') {
      const term = currentTerm();
      const vis = visibleStudents(u);
      const out = { role: u.role, term };
      out.announcements = listResource('announcements', u, { limit: 4 }).rows;
      out.events = q("SELECT * FROM events WHERE COALESCE(end_date,date) >= date('now') ORDER BY date LIMIT 6");
      if (sec.can(u.role, 'students')) {
        const cond = vis === null ? "status='Active'" : `status='Active' AND id IN (${vis.join(',') || 'NULL'})`;
        out.students = one(`SELECT COUNT(*) n, SUM(gender='F') f, SUM(gender='M') m FROM students WHERE ${cond}`);
        out.enrollment = q(`SELECT c.name label, COUNT(s.id) value FROM classes c LEFT JOIN students s ON s.class_id=c.id AND s.${cond.replace(/ AND id/, ' AND s.id')} GROUP BY c.id ORDER BY c.name`);
      }
      if (sec.can(u.role, 'staff') || u.role === 'director') out.staff = one("SELECT COUNT(*) n, SUM(job_title='Teacher') teachers FROM staff WHERE status='Active'");
      if (sec.can(u.role, 'attendance')) {
        const sf = vis === null ? '' : ` AND a.student_id IN (${vis.join(',') || 'NULL'})`;
        out.attendance = attendanceStats(`a.date >= date('now','-30 days')${sf}`, []);
        out.attendanceToday = attendanceStats(`a.date = date('now')${sf}`, []);
        out.attendanceTrend = q(`SELECT a.date label, ROUND(100.0*SUM(a.status IN ('P','L'))/COUNT(*),1) value FROM student_attendance a WHERE 1=1${sf} GROUP BY a.date ORDER BY a.date DESC LIMIT 15`).reverse();
        out.absentees = chronicAbsentees(10, 3, vis).slice(0, 8);
      }
      if (sec.can(u.role, 'finance')) {
        const f = financeSummary(term.id);
        out.finance = { billed: f.billed, collected: f.collected, outstanding: f.outstanding, rate: f.rate, expenses: f.expenses, byMethod: f.byMethod };
        out.cashflow = cashflow(6);
        out.pendingExpenses = q("SELECT * FROM expenses WHERE status='Pending' ORDER BY spent_on DESC LIMIT 5");
        out.recentPayments = listResource('payments', u, { limit: 6 }).rows;
      }
      if (sec.can(u.role, 'academics') && u.role !== 'teacher') out.academic = REPORTS.academic.run({ term_id: term.id }).rows;
      if (['hr', 'headteacher', 'director'].includes(u.role)) {
        out.pendingLeave = listResource('leave_requests', u, { status: 'Pending' }).rows;
        out.expiringContracts = q("SELECT id, first_name||' '||last_name name, job_title, contract_end FROM staff WHERE status='Active' AND contract_end <= date('now','+120 days') ORDER BY contract_end");
      }
      if (['headteacher', 'director'].includes(u.role)) out.unapprovedMarks = one('SELECT COUNT(*) n FROM marks WHERE approved=0').n;
      if (u.role === 'teacher') {
        const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()];
        out.myClasses = q(`SELECT c.id, c.name, (SELECT COUNT(*) FROM students s WHERE s.class_id=c.id AND s.status='Active') students,
          (SELECT COUNT(*) FROM student_attendance a JOIN students s ON s.id=a.student_id WHERE s.class_id=c.id AND a.date=date('now')) marked_today
          FROM classes c WHERE c.id IN (${teacherClasses(u).join(',') || 'NULL'}) ORDER BY c.name`);
        out.todayLessons = q(`SELECT t.period, c.name class_name, s.name subject, t.room FROM timetable t JOIN classes c ON c.id=t.class_id JOIN subjects s ON s.id=t.subject_id
          WHERE t.teacher_id=? AND t.day=? ORDER BY t.period`, u.staff_id || -1, day);
      }
      if (sec.can(u.role, 'library')) out.overdueBooks = one("SELECT COUNT(*) n FROM book_loans WHERE returned_on IS NULL AND due_on < date('now')").n;
      if (sec.can(u.role, 'inventory')) out.lowStock = q('SELECT item, quantity, unit FROM inventory WHERE quantity < 20 ORDER BY quantity');
      if (u.role === 'sysadmin') {
        out.system = { users: one('SELECT COUNT(*) n FROM users WHERE active=1').n, sessions: one('SELECT COUNT(*) n FROM sessions WHERE expires_at > ?', Date.now()).n,
          failedLogins: one("SELECT COUNT(*) n FROM audit_logs WHERE action='login_failed' AND at >= datetime('now','-1 day')").n, dbSize: fs.statSync(dbFile).size };
        out.recentAudit = q('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 8');
      }
      return send(res, 200, out);
    }

    if (p === '/portal') {
      need(u, 'portal');
      const ids = visibleStudents(u);
      const term = currentTerm();
      const kids = ids.map((id) => {
        const s = one(`SELECT s.*, c.name class_name FROM students s LEFT JOIN classes c ON c.id=s.class_id WHERE s.id=?`, id);
        const att = attendanceStats('a.student_id=? AND a.date >= ?', [id, term.start_date]);
        const inv = listResource('invoices', u, { student_id: id }).rows;
        const results = studentTermResults(s.class_id, term.id).rows.find((r) => r.id === id);
        const recent = q("SELECT date, status FROM student_attendance WHERE student_id=? ORDER BY date DESC LIMIT 10", id);
        return { student: s, attendance: att, recent, invoices: inv, balance: inv.reduce((a, b) => a + Math.max(0, b.balance), 0), results };
      });
      return send(res, 200, { kids, term });
    }

    m = p.match(/^\/students\/(\d+)\/profile$/);
    if (m) {
      const id = Number(m[1]);
      if (!mayViewStudent(u, id)) throw httpErr(403, 'Not allowed to view this student');
      const s = one('SELECT s.*, c.name class_name FROM students s LEFT JOIN classes c ON c.id=s.class_id WHERE s.id=?', id);
      if (!s) throw httpErr(404, 'Not found');
      const out = { student: s };
      out.attendance = attendanceStats('a.student_id=?', [id]);
      out.attendanceLog = q('SELECT date, status, note FROM student_attendance WHERE student_id=? ORDER BY date DESC LIMIT 30', id);
      out.terms = q('SELECT DISTINCT a.term_id id, t.name FROM marks m JOIN assessments a ON a.id=m.assessment_id JOIN terms t ON t.id=a.term_id WHERE m.student_id=? ORDER BY 1', id)
        .map((t) => { const r = studentTermResults(s.class_id, t.id).rows.find((x) => x.id === id); return { ...t, average: r && r.average, grade: r && r.grade, position: r && r.position }; });
      if (sec.can(u.role, 'finance') || ['parent', 'student'].includes(u.role)) {
        out.invoices = listResource('invoices', { role: 'bursar' }, { student_id: id }).rows;
        out.payments = listResource('payments', { role: 'bursar' }, { student_id: id }).rows;
      }
      if (sec.can(u.role, 'discipline')) out.discipline = q('SELECT * FROM discipline WHERE student_id=? ORDER BY date DESC', id);
      out.loans = q('SELECT l.*, b.title FROM book_loans l JOIN books b ON b.id=l.book_id WHERE l.student_id=? ORDER BY borrowed_on DESC', id);
      audit(u, 'view_profile', 'students', id, null, ip);
      return send(res, 200, out);
    }

    // ---- Attendance ----
    if (p === '/attendance' && method === 'GET') {
      need(u, 'attendance');
      const classId = Number(query.class_id); const date = query.date || today();
      if (u.role === 'teacher' && !teacherClasses(u).includes(classId)) throw httpErr(403, 'Not your class');
      const rows = q(`SELECT s.id, s.adm_no, s.first_name||' '||s.last_name name, s.gender, a.status, a.note,
        (SELECT ROUND(100.0*SUM(x.status IN ('P','L'))/COUNT(*),1) FROM student_attendance x WHERE x.student_id=s.id) rate
        FROM students s LEFT JOIN student_attendance a ON a.student_id=s.id AND a.date=? WHERE s.class_id=? AND s.status='Active' ORDER BY s.last_name, s.first_name`, date, classId);
      return send(res, 200, { date, rows });
    }
    if (p === '/attendance' && method === 'POST') {
      need(u, 'attendance', 'w');
      const classId = Number(body.class_id); const date = body.date || today();
      if (date > today()) throw httpErr(400, 'Cannot record attendance for a future date');
      if (u.role === 'teacher' && !teacherClasses(u).includes(classId)) throw httpErr(403, 'Not your class');
      const valid = new Set(q("SELECT id FROM students WHERE class_id=? AND status='Active'", classId).map((x) => x.id));
      const st = db.prepare(`INSERT INTO student_attendance(student_id,date,status,note,recorded_by) VALUES(?,?,?,?,?)
        ON CONFLICT(student_id,date) DO UPDATE SET status=excluded.status, note=excluded.note, recorded_by=excluded.recorded_by`);
      let n = 0;
      tx(db, () => { for (const r of body.records || []) if (valid.has(Number(r.student_id)) && ['P', 'A', 'L', 'E'].includes(r.status)) { st.run(r.student_id, date, r.status, r.note || null, u.id); n++; } });
      audit(u, 'attendance', 'classes', classId, { date, records: n, offline: !!body.offline }, ip);
      return send(res, 200, { ok: true, saved: n });
    }
    if (p === '/staff-attendance' && method === 'GET') {
      need(u, 'staff_attendance');
      const date = query.date || today();
      return send(res, 200, { date, rows: q(`SELECT s.id, s.staff_no, s.first_name||' '||s.last_name name, s.job_title, a.status FROM staff s LEFT JOIN staff_attendance a ON a.staff_id=s.id AND a.date=? WHERE s.status='Active' ORDER BY s.last_name`, date) });
    }
    if (p === '/staff-attendance' && method === 'POST') {
      need(u, 'staff_attendance', 'w');
      const st = db.prepare(`INSERT INTO staff_attendance(staff_id,date,status,recorded_by) VALUES(?,?,?,?) ON CONFLICT(staff_id,date) DO UPDATE SET status=excluded.status, recorded_by=excluded.recorded_by`);
      tx(db, () => { for (const r of body.records || []) if (['P', 'A', 'L', 'E'].includes(r.status)) st.run(r.staff_id, body.date || today(), r.status, u.id); });
      audit(u, 'staff_attendance', 'staff', null, { date: body.date, records: (body.records || []).length }, ip);
      return send(res, 200, { ok: true });
    }

    // ---- Leave ----
    if (p === '/leave/request' && method === 'POST') {
      if (!u.staff_id) throw httpErr(400, 'Only staff accounts can request leave');
      if (!body.start_date || !body.end_date || body.end_date < body.start_date) throw httpErr(400, 'Please give a valid date range');
      const r = run('INSERT INTO leave_requests(staff_id,leave_type,start_date,end_date,reason) VALUES(?,?,?,?,?)', u.staff_id, body.leave_type || 'Annual', body.start_date, body.end_date, body.reason || '');
      audit(u, 'create', 'leave_requests', r.lastInsertRowid, body, ip);
      return send(res, 201, { id: Number(r.lastInsertRowid) });
    }
    m = p.match(/^\/leave\/(\d+)\/decide$/);
    if (m && method === 'POST') {
      need(u, 'leave', 'w');
      if (!['Approved', 'Rejected'].includes(body.status)) throw httpErr(400, 'Invalid decision');
      run("UPDATE leave_requests SET status=?, decided_by=? WHERE id=? AND status='Pending'", body.status, u.id, m[1]);
      audit(u, `leave_${body.status.toLowerCase()}`, 'leave_requests', m[1], null, ip);
      return send(res, 200, { ok: true });
    }

    // ---- Marks ----
    if (p === '/marks' && method === 'GET') {
      need(u, 'marks');
      const { class_id, assessment_id, subject_id } = query;
      if (u.role === 'teacher' && !one('SELECT 1 FROM teacher_assignments WHERE class_id=? AND subject_id=? AND teacher_id=?', class_id, subject_id, u.staff_id)) throw httpErr(403, 'You are not assigned to teach this subject in this class');
      const a = one('SELECT * FROM assessments WHERE id=?', assessment_id);
      const rows = q(`SELECT s.id, s.adm_no, s.first_name||' '||s.last_name name, m.score, m.approved FROM students s
        LEFT JOIN marks m ON m.student_id=s.id AND m.assessment_id=? AND m.subject_id=? WHERE s.class_id=? AND s.status='Active' ORDER BY s.last_name, s.first_name`, assessment_id, subject_id, class_id);
      return send(res, 200, { assessment: a, rows });
    }
    if (p === '/marks' && method === 'POST') {
      need(u, 'marks', 'w');
      const a = one('SELECT * FROM assessments WHERE id=?', body.assessment_id);
      if (!a) throw httpErr(400, 'Unknown assessment');
      if (u.role === 'teacher' && !one('SELECT 1 FROM teacher_assignments WHERE class_id=? AND subject_id=? AND teacher_id=?', body.class_id, body.subject_id, u.staff_id)) throw httpErr(403, 'You are not assigned to this subject/class');
      const st = db.prepare(`INSERT INTO marks(assessment_id,student_id,subject_id,score,approved,entered_by) VALUES(?,?,?,?,0,?)
        ON CONFLICT(assessment_id,student_id,subject_id) DO UPDATE SET score=excluded.score, approved=CASE WHEN marks.score=excluded.score THEN marks.approved ELSE 0 END, entered_by=excluded.entered_by, updated_at=CURRENT_TIMESTAMP`);
      const valid = new Set(q("SELECT id FROM students WHERE class_id=?", body.class_id).map((x) => x.id));
      let n = 0;
      tx(db, () => {
        for (const r of body.records || []) {
          if (r.score === '' || r.score == null) continue;
          const s = Number(r.score);
          if (!valid.has(Number(r.student_id)) || Number.isNaN(s) || s < 0 || s > a.max_score) throw httpErr(400, `Score ${r.score} is outside 0–${a.max_score}`);
          st.run(a.id, r.student_id, body.subject_id, s, u.id); n++;
        }
      });
      audit(u, 'marks_entry', 'marks', null, { assessment: a.id, subject: body.subject_id, class: body.class_id, records: n, offline: !!body.offline }, ip);
      return send(res, 200, { ok: true, saved: n });
    }
    if (p === '/marks/approve' && method === 'POST') {
      need(u, 'approve_marks', 'w');
      const r = run(`UPDATE marks SET approved=1 WHERE approved=0 AND assessment_id=? AND subject_id=? AND student_id IN (SELECT id FROM students WHERE class_id=?)`, body.assessment_id, body.subject_id, body.class_id);
      audit(u, 'marks_approve', 'marks', null, { ...body, count: r.changes }, ip);
      return send(res, 200, { ok: true, approved: r.changes });
    }
    if (p === '/marks/pending') {
      need(u, 'approve_marks');
      return send(res, 200, q(`SELECT a.id assessment_id, a.name assessment, t.name term, sj.id subject_id, sj.name subject, c.id class_id, c.name class_name, COUNT(*) count
        FROM marks m JOIN assessments a ON a.id=m.assessment_id JOIN terms t ON t.id=a.term_id JOIN subjects sj ON sj.id=m.subject_id JOIN students s ON s.id=m.student_id JOIN classes c ON c.id=s.class_id
        WHERE m.approved=0 GROUP BY a.id, sj.id, c.id ORDER BY c.name`));
    }
    if (p === '/results') {
      const classId = Number(query.class_id); const termId = Number(query.term_id || currentTerm().id);
      if (['parent', 'student'].includes(u.role)) throw httpErr(403, 'Not allowed');
      need(u, 'academics');
      if (u.role === 'teacher' && !teacherClasses(u).includes(classId)) throw httpErr(403, 'Not your class');
      return send(res, 200, studentTermResults(classId, termId));
    }
    if (p === '/reportcard') {
      const id = Number(query.student_id); const termId = Number(query.term_id || currentTerm().id);
      if (!mayViewStudent(u, id)) throw httpErr(403, 'Not allowed');
      const s = one('SELECT s.*, c.name class_name, st.first_name||\' \'||st.last_name class_teacher FROM students s LEFT JOIN classes c ON c.id=s.class_id LEFT JOIN staff st ON st.id=c.class_teacher_id WHERE s.id=?', id);
      const res_ = studentTermResults(s.class_id, termId);
      const row = res_.rows.find((r) => r.id === id);
      const t = one('SELECT t.*, y.name year FROM terms t JOIN academic_years y ON y.id=t.year_id WHERE t.id=?', termId);
      const att = attendanceStats('a.student_id=? AND a.date BETWEEN ? AND ?', [id, t.start_date, t.end_date]);
      audit(u, 'report_card', 'students', id, { term: termId }, ip);
      return send(res, 200, { student: s, term: t, assessments: res_.assessments, result: row, classSize: res_.classSize, attendance: att, school: Object.fromEntries(q('SELECT key, value FROM school_settings').map((r) => [r.key, r.value])) });
    }

    // ---- Timetable ----
    if (p === '/timetable' && method === 'GET') {
      need(u, 'timetable');
      let where = 't.class_id=?', param = query.class_id;
      if (query.teacher_id) { where = 't.teacher_id=?'; param = query.teacher_id; }
      if (u.role === 'student' || u.role === 'parent') { const sid = u.role === 'student' ? u.student_id : (visibleStudents(u).find((x) => x == query.student_id) || visibleStudents(u)[0]); where = 't.class_id=?'; param = one('SELECT class_id FROM students WHERE id=?', sid).class_id; }
      return send(res, 200, q(`SELECT t.*, s.name subject, s.code, c.name class_name, st.first_name||' '||st.last_name teacher FROM timetable t LEFT JOIN subjects s ON s.id=t.subject_id
        JOIN classes c ON c.id=t.class_id LEFT JOIN staff st ON st.id=t.teacher_id WHERE ${where}`, param));
    }
    if (p === '/timetable' && method === 'POST') {
      need(u, 'timetable', 'w');
      const { class_id, day, period, subject_id, room } = body;
      if (!subject_id) { run('DELETE FROM timetable WHERE class_id=? AND day=? AND period=?', class_id, day, period); audit(u, 'timetable_clear', 'timetable', null, body, ip); return send(res, 200, { ok: true }); }
      const teacher = body.teacher_id || (one('SELECT teacher_id FROM teacher_assignments WHERE class_id=? AND subject_id=?', class_id, subject_id) || {}).teacher_id;
      const clash = teacher && one(`SELECT c.name FROM timetable t JOIN classes c ON c.id=t.class_id WHERE t.teacher_id=? AND t.day=? AND t.period=? AND t.class_id<>?`, teacher, day, period, class_id);
      if (clash && !body.force) throw httpErr(409, `Conflict: this teacher already teaches ${clash.name} on ${day} period ${period}`);
      const roomClash = room && one('SELECT c.name FROM timetable t JOIN classes c ON c.id=t.class_id WHERE t.room=? AND t.day=? AND t.period=? AND t.class_id<>?', room, day, period, class_id);
      if (roomClash && !body.force) throw httpErr(409, `Conflict: ${room} is used by ${roomClash.name} at that time`);
      run(`INSERT INTO timetable(class_id,day,period,subject_id,teacher_id,room) VALUES(?,?,?,?,?,?) ON CONFLICT(class_id,day,period) DO UPDATE SET subject_id=excluded.subject_id, teacher_id=excluded.teacher_id, room=excluded.room`,
        class_id, day, period, subject_id, teacher || null, room || null);
      audit(u, 'timetable_set', 'timetable', null, body, ip);
      return send(res, 200, { ok: true });
    }
    if (p === '/timetable/conflicts') {
      need(u, 'timetable');
      return send(res, 200, q(`SELECT t.day, t.period, st.first_name||' '||st.last_name teacher, GROUP_CONCAT(c.name, ', ') classes FROM timetable t JOIN staff st ON st.id=t.teacher_id JOIN classes c ON c.id=t.class_id
        GROUP BY t.teacher_id, t.day, t.period HAVING COUNT(*) > 1`));
    }

    // ---- Finance ----
    if (p === '/finance/summary') { need(u, 'finance'); return send(res, 200, { ...financeSummary(Number(query.term_id) || currentTerm().id), cashflow: cashflow(10) }); }
    if (p === '/invoices/generate' && method === 'POST') {
      need(u, 'finance', 'w');
      const termId = Number(body.term_id);
      const t = one('SELECT * FROM terms WHERE id=?', termId); if (!t) throw httpErr(400, 'Unknown term');
      const fees = q('SELECT * FROM fee_structures WHERE term_id=?', termId);
      if (!fees.length) throw httpErr(400, 'Define a fee structure for this term first');
      const y = t.start_date.slice(0, 4);
      let created = 0;
      tx(db, () => {
        let seq = Number((one("SELECT MAX(CAST(substr(invoice_no, -5) AS INTEGER)) m FROM invoices WHERE invoice_no LIKE ?", `INV-${y}-%`) || {}).m || 0);
        for (const s of q("SELECT id, class_id FROM students WHERE status='Active'")) {
          const amount = fees.filter((f) => f.class_id == null || f.class_id === s.class_id).reduce((a, b) => a + b.amount, 0);
          if (!amount) continue;
          const r = run('INSERT OR IGNORE INTO invoices(invoice_no,student_id,term_id,amount,issued_on,due_on,created_by) VALUES(?,?,?,?,?,?,?)',
            `INV-${y}-${String(seq + 1).padStart(5, '0')}`, s.id, termId, amount, today(), t.start_date.slice(0, 8) + '30', u.id);
          if (r.changes) { seq++; created++; }
        }
      });
      audit(u, 'invoices_generate', 'invoices', null, { term: termId, created }, ip);
      return send(res, 200, { ok: true, created });
    }
    if (p === '/payments' && method === 'POST') {
      need(u, 'finance', 'w');
      const inv = one(`SELECT i.*, i.amount-COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id=i.id AND reversed=0),0) balance FROM invoices i WHERE id=?`, body.invoice_id);
      if (!inv) throw httpErr(400, 'Select a valid invoice');
      const amount = Math.round(Number(body.amount));
      if (!(amount > 0)) throw httpErr(400, 'Amount must be greater than zero');
      if (amount > inv.balance && !body.allow_overpay) throw httpErr(409, `Amount exceeds the outstanding balance (${inv.balance}). Tick "allow overpayment" to record a credit.`);
      const methodName = ['Cash', 'Bank', 'Mobile Money'].includes(body.method) ? body.method : 'Cash';
      const ref = (body.reference || '').trim() || null;
      if (methodName !== 'Cash' && !ref) throw httpErr(400, 'Bank and mobile-money payments need a transaction reference');
      if (ref && one('SELECT receipt_no FROM payments WHERE method=? AND reference=?', methodName, ref)) throw httpErr(409, `Duplicate: reference ${ref} has already been recorded`);
      const y = new Date().getFullYear();
      const r = tx(db, () => {
        const seq = Number((one("SELECT MAX(CAST(substr(receipt_no, -5) AS INTEGER)) m FROM payments WHERE receipt_no LIKE ?", `RC-${y}-%`) || {}).m || 0) + 1;
        const receipt = `RC-${y}-${String(seq).padStart(5, '0')}`;
        const ins = run('INSERT INTO payments(receipt_no,invoice_id,student_id,amount,method,reference,paid_on,recorded_by) VALUES(?,?,?,?,?,?,?,?)',
          receipt, inv.id, inv.student_id, amount, methodName, ref, body.paid_on || today(), u.id);
        return { id: Number(ins.lastInsertRowid), receipt_no: receipt };
      });
      audit(u, 'payment', 'payments', r.id, { invoice: inv.invoice_no, amount, method: methodName, ref }, ip);
      return send(res, 201, r);
    }
    m = p.match(/^\/payments\/(\d+)\/reverse$/);
    if (m && method === 'POST') {
      need(u, 'finance', 'w');
      if (!String(body.reason || '').trim()) throw httpErr(400, 'A reason is required to reverse a payment');
      const r = run('UPDATE payments SET reversed=1, reversed_by=?, reverse_reason=? WHERE id=? AND reversed=0', u.id, body.reason, m[1]);
      if (!r.changes) throw httpErr(409, 'Payment not found or already reversed');
      audit(u, 'payment_reverse', 'payments', m[1], { reason: body.reason }, ip);
      return send(res, 200, { ok: true });
    }
    m = p.match(/^\/payments\/(\d+)\/receipt$/);
    if (m) {
      const pay = one(`SELECT p.*, s.first_name||' '||s.last_name student_name, s.adm_no, c.name class_name, i.invoice_no, i.amount invoice_amount, t.name term_name, u.full_name cashier,
        i.amount-COALESCE((SELECT SUM(amount) FROM payments x WHERE x.invoice_id=i.id AND x.reversed=0),0) balance
        FROM payments p JOIN students s ON s.id=p.student_id LEFT JOIN classes c ON c.id=s.class_id JOIN invoices i ON i.id=p.invoice_id JOIN terms t ON t.id=i.term_id LEFT JOIN users u ON u.id=p.recorded_by WHERE p.id=?`, m[1]);
      if (!pay || !(sec.can(u.role, 'finance') || mayViewStudent(u, pay.student_id))) throw httpErr(404, 'Not found');
      return send(res, 200, { payment: pay, school: Object.fromEntries(q('SELECT key, value FROM school_settings').map((r) => [r.key, r.value])) });
    }
    m = p.match(/^\/expenses\/(\d+)\/(approve|reject)$/);
    if (m && method === 'POST') {
      need(u, 'approve_expense', 'w');
      const r = run("UPDATE expenses SET status=?, approved_by=? WHERE id=? AND status='Pending'", m[2] === 'approve' ? 'Approved' : 'Rejected', u.id, m[1]);
      if (!r.changes) throw httpErr(409, 'Expense is not pending');
      audit(u, `expense_${m[2]}`, 'expenses', m[1], null, ip);
      return send(res, 200, { ok: true });
    }
    if (p === '/payroll/generate' && method === 'POST') {
      need(u, 'payroll', 'w');
      if (!/^\d{4}-\d{2}$/.test(body.month || '')) throw httpErr(400, 'Month must look like 2026-10');
      const rate = Number(body.deduction_rate ?? 0.18);
      let n = 0;
      tx(db, () => { for (const s of q("SELECT id, salary FROM staff WHERE status='Active' AND salary > 0")) { const d = Math.round(s.salary * rate); n += run('INSERT OR IGNORE INTO payroll(month,staff_id,gross,deductions,net,created_by) VALUES(?,?,?,?,?,?)', body.month, s.id, s.salary, d, s.salary - d, u.id).changes; } });
      audit(u, 'payroll_generate', 'payroll', null, { month: body.month, created: n }, ip);
      return send(res, 200, { ok: true, created: n });
    }
    if (p === '/payroll/mark-paid' && method === 'POST') {
      need(u, 'finance', 'w');
      const r = run("UPDATE payroll SET status='Paid' WHERE month=? AND status='Draft'", body.month);
      audit(u, 'payroll_paid', 'payroll', null, { month: body.month, count: r.changes }, ip);
      return send(res, 200, { ok: true, updated: r.changes });
    }

    // ---- Library ----
    m = p.match(/^\/loans\/(\d+)\/return$/);
    if (m && method === 'POST') {
      need(u, 'library', 'w');
      const l = one('SELECT * FROM book_loans WHERE id=? AND returned_on IS NULL', m[1]);
      if (!l) throw httpErr(409, 'Loan already returned');
      const late = Math.max(0, Math.floor((Date.parse(today()) - Date.parse(l.due_on)) / 864e5));
      const fine = late * 100;
      run('UPDATE book_loans SET returned_on=?, fine=? WHERE id=?', today(), fine, l.id);
      audit(u, 'book_return', 'book_loans', l.id, { late, fine }, ip);
      return send(res, 200, { ok: true, fine, daysLate: late });
    }

    // ---- Reports ----
    m = p.match(/^\/reports\/([a-z]+)$/);
    if (m && REPORTS[m[1]]) {
      const rep = REPORTS[m[1]];
      need(u, 'reports'); need(u, rep.perm);
      const out = rep.run(query);
      if (query.export) audit(u, 'export', 'reports', m[1], { format: query.export, filters: query }, ip);
      return send(res, 200, { key: m[1], title: rep.title, generated: new Date().toISOString(), school: setting('school_name'), ...out });
    }
    if (p === '/reports') {
      return send(res, 200, Object.entries(REPORTS).filter(([, r]) => sec.can(u.role, 'reports') && sec.can(u.role, r.perm)).map(([k, r]) => ({ key: k, title: r.title })));
    }

    // ---- Search ----
    if (p === '/search') {
      const term = String(query.q || '').trim();
      if (term.length < 2) return send(res, 200, []);
      const out = [];
      if (sec.can(u.role, 'students')) listResource('students', u, { q: term, limit: 6 }).rows.forEach((s) => out.push({ type: 'Student', label: `${s.first_name} ${s.last_name}`, sub: `${s.adm_no} · ${s.class_name || ''}`, href: `#/students/${s.id}` }));
      if (sec.can(u.role, 'staff')) listResource('staff', u, { q: term, limit: 4 }).rows.forEach((s) => out.push({ type: 'Staff', label: `${s.first_name} ${s.last_name}`, sub: `${s.staff_no} · ${s.job_title}`, href: `#/staff?id=${s.id}` }));
      if (sec.can(u.role, 'finance')) {
        listResource('invoices', u, { q: term, limit: 4 }).rows.forEach((i) => out.push({ type: 'Invoice', label: i.invoice_no, sub: `${i.student_name} · balance ${i.balance}`, href: `#/finance?tab=invoices&q=${encodeURIComponent(i.invoice_no)}` }));
        listResource('payments', u, { q: term, limit: 4 }).rows.forEach((p_) => out.push({ type: 'Receipt', label: p_.receipt_no, sub: `${p_.student_name} · ${p_.amount}`, href: `#/receipt/${p_.id}` }));
      }
      if (sec.can(u.role, 'library')) listResource('books', u, { q: term, limit: 3 }).rows.forEach((b) => out.push({ type: 'Book', label: b.title, sub: b.author, href: '#/library' }));
      return send(res, 200, out);
    }

    // ---- System ----
    m = p.match(/^\/users\/(\d+)\/reset$/);
    if (m && method === 'POST') {
      need(u, 'users', 'w');
      if (String(body.password || '').length < 8) throw httpErr(400, 'Password must have at least 8 characters');
      run('UPDATE users SET password_hash=? WHERE id=?', sec.hashPassword(body.password), m[1]);
      run('DELETE FROM sessions WHERE user_id=?', m[1]);
      audit(u, 'password_reset', 'users', m[1], null, ip);
      return send(res, 200, { ok: true });
    }
    if (p === '/settings' && method === 'PUT') {
      need(u, 'settings', 'w');
      const allowed = ['school_name', 'motto', 'currency', 'address', 'phone', 'pass_mark'];
      const st = db.prepare('INSERT INTO school_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
      for (const k of allowed) if (body[k] !== undefined) st.run(k, String(body[k]));
      if (body.current_term_id) { run('UPDATE terms SET is_current=0'); run('UPDATE terms SET is_current=1 WHERE id=?', body.current_term_id); }
      audit(u, 'settings_update', 'settings', null, body, ip);
      return send(res, 200, { ok: true });
    }
    if (p === '/backup') {
      need(u, 'settings', 'w');
      const tmp = path.join(os.tmpdir(), `smis-backup-${Date.now()}.db`);
      db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      const buf = fs.readFileSync(tmp); fs.unlinkSync(tmp);
      audit(u, 'backup', 'system', null, { bytes: buf.length }, ip);
      return send(res, 200, buf, { 'Content-Disposition': `attachment; filename="smis-backup-${today()}.db"` });
    }
    if (p === '/system') {
      need(u, 'settings');
      const nets = Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
      return send(res, 200, { node: process.version, platform: `${os.type()} ${os.release()}`, dbFile, dbSize: fs.statSync(dbFile).size, lanAddresses: nets, port: server.address()?.port, uptime: process.uptime() });
    }

    throw httpErr(404, 'Unknown endpoint');
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        res.setHeader('Cache-Control', 'no-store');
        Object.entries(SEC_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
        await api(req, res, url);
      } else serveStatic(req, res, decodeURIComponent(url.pathname));
    } catch (e) {
      const status = e.status || (/UNIQUE constraint/.test(e.message) ? 409 : /CHECK constraint|NOT NULL|FOREIGN KEY/.test(e.message) ? 400 : 500);
      const msg = e.status ? e.message : /UNIQUE constraint failed: (\w+)\.(\w+)/.test(e.message) ? `A record with this ${e.message.match(/\.(\w+)/)[1].replace(/_/g, ' ')} already exists` : status === 400 ? 'Some required information is missing or invalid' : 'Something went wrong on the server';
      if (status === 500) console.error(e);
      if (!res.headersSent) send(res, status, { error: msg });
    }
  });
  server.db = db;
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  createServer().listen(port, host, () => {
    const lan = Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => `http://${n.address}:${port}`);
    console.log(`\n  SMIS is running\n  This computer:  http://localhost:${port}\n  School network: ${lan.join('  ') || '(no network found)'}\n`);
  });
}

module.exports = { createServer };
