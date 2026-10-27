// Database layer: schema, migrations and demo seed data (SQLite via Node's built-in node:sqlite).
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const { hashPassword } = require('./security');

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS school_settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS academic_years (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, is_current INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS terms (
  id INTEGER PRIMARY KEY, year_id INTEGER NOT NULL REFERENCES academic_years(id),
  name TEXT NOT NULL, start_date TEXT, end_date TEXT, is_current INTEGER DEFAULT 0, UNIQUE(year_id, name));

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY, staff_no TEXT UNIQUE NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
  gender TEXT, job_title TEXT, department TEXT, phone TEXT, email TEXT, qualification TEXT,
  salary INTEGER DEFAULT 0, hired_on TEXT, contract_end TEXT, status TEXT DEFAULT 'Active',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, level TEXT, stream TEXT,
  class_teacher_id INTEGER REFERENCES staff(id), capacity INTEGER DEFAULT 45);
CREATE TABLE IF NOT EXISTS subjects (id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, department TEXT);
CREATE TABLE IF NOT EXISTS teacher_assignments (
  id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id), subject_id INTEGER NOT NULL REFERENCES subjects(id),
  teacher_id INTEGER REFERENCES staff(id), UNIQUE(class_id, subject_id));

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY, adm_no TEXT UNIQUE NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
  gender TEXT, dob TEXT, class_id INTEGER REFERENCES classes(id), status TEXT DEFAULT 'Active',
  guardian_name TEXT, guardian_phone TEXT, guardian_email TEXT, address TEXT, emergency_contact TEXT,
  boarding TEXT DEFAULT 'Day', enrolled_on TEXT, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(first_name, last_name, dob));

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL,
  full_name TEXT NOT NULL, staff_id INTEGER REFERENCES staff(id), student_id INTEGER REFERENCES students(id),
  active INTEGER DEFAULT 1, last_login TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS guardian_links (user_id INTEGER REFERENCES users(id), student_id INTEGER REFERENCES students(id), PRIMARY KEY(user_id, student_id));
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL, ip TEXT);

CREATE TABLE IF NOT EXISTS student_attendance (
  id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id), date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('P','A','L','E')), note TEXT, recorded_by INTEGER, UNIQUE(student_id, date));
CREATE TABLE IF NOT EXISTS staff_attendance (
  id INTEGER PRIMARY KEY, staff_id INTEGER NOT NULL REFERENCES staff(id), date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('P','A','L','E')), recorded_by INTEGER, UNIQUE(staff_id, date));
CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY, staff_id INTEGER NOT NULL REFERENCES staff(id), leave_type TEXT, start_date TEXT, end_date TEXT,
  reason TEXT, status TEXT DEFAULT 'Pending', decided_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS assessments (
  id INTEGER PRIMARY KEY, term_id INTEGER NOT NULL REFERENCES terms(id), name TEXT NOT NULL, max_score INTEGER NOT NULL,
  UNIQUE(term_id, name));
CREATE TABLE IF NOT EXISTS marks (
  id INTEGER PRIMARY KEY, assessment_id INTEGER NOT NULL REFERENCES assessments(id), student_id INTEGER NOT NULL REFERENCES students(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id), score REAL NOT NULL, approved INTEGER DEFAULT 0, entered_by INTEGER,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(assessment_id, student_id, subject_id));
CREATE TABLE IF NOT EXISTS timetable (
  id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id), day TEXT NOT NULL, period INTEGER NOT NULL,
  subject_id INTEGER REFERENCES subjects(id), teacher_id INTEGER REFERENCES staff(id), room TEXT, UNIQUE(class_id, day, period));

CREATE TABLE IF NOT EXISTS fee_structures (
  id INTEGER PRIMARY KEY, term_id INTEGER NOT NULL REFERENCES terms(id), class_id INTEGER REFERENCES classes(id),
  item TEXT NOT NULL, amount INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY, invoice_no TEXT UNIQUE NOT NULL, student_id INTEGER NOT NULL REFERENCES students(id),
  term_id INTEGER NOT NULL REFERENCES terms(id), amount INTEGER NOT NULL, issued_on TEXT, due_on TEXT, created_by INTEGER,
  UNIQUE(student_id, term_id));
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, receipt_no TEXT UNIQUE NOT NULL, invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  student_id INTEGER NOT NULL REFERENCES students(id), amount INTEGER NOT NULL CHECK(amount > 0),
  method TEXT NOT NULL, reference TEXT, paid_on TEXT NOT NULL, recorded_by INTEGER,
  reversed INTEGER DEFAULT 0, reversed_by INTEGER, reverse_reason TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_ref ON payments(method, reference) WHERE reference IS NOT NULL AND reference <> '';
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY, category TEXT NOT NULL, description TEXT, supplier TEXT, amount INTEGER NOT NULL CHECK(amount > 0),
  spent_on TEXT NOT NULL, status TEXT DEFAULT 'Pending', recorded_by INTEGER, approved_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY, term_id INTEGER NOT NULL REFERENCES terms(id), category TEXT NOT NULL, amount INTEGER NOT NULL,
  UNIQUE(term_id, category));
CREATE TABLE IF NOT EXISTS payroll (
  id INTEGER PRIMARY KEY, month TEXT NOT NULL, staff_id INTEGER NOT NULL REFERENCES staff(id), gross INTEGER NOT NULL,
  deductions INTEGER NOT NULL, net INTEGER NOT NULL, status TEXT DEFAULT 'Draft', created_by INTEGER, UNIQUE(month, staff_id));

CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY, isbn TEXT, title TEXT NOT NULL, author TEXT, category TEXT, copies INTEGER DEFAULT 1, shelf TEXT);
CREATE TABLE IF NOT EXISTS book_loans (
  id INTEGER PRIMARY KEY, book_id INTEGER NOT NULL REFERENCES books(id), student_id INTEGER NOT NULL REFERENCES students(id),
  borrowed_on TEXT NOT NULL, due_on TEXT NOT NULL, returned_on TEXT, fine INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY, item TEXT NOT NULL, category TEXT, quantity INTEGER DEFAULT 0, unit TEXT, location TEXT,
  condition TEXT DEFAULT 'Good', supplier TEXT, unit_cost INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS discipline (
  id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id), date TEXT NOT NULL, incident TEXT NOT NULL,
  action_taken TEXT, status TEXT DEFAULT 'Open', recorded_by INTEGER);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT, audience TEXT DEFAULT 'All', pinned INTEGER DEFAULT 0,
  created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, date TEXT NOT NULL, end_date TEXT, category TEXT DEFAULT 'Event', description TEXT);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY, user_id INTEGER, username TEXT, action TEXT NOT NULL, entity TEXT, entity_id TEXT, details TEXT,
  ip TEXT, at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS ix_att_date ON student_attendance(date);
CREATE INDEX IF NOT EXISTS ix_marks_student ON marks(student_id);
CREATE INDEX IF NOT EXISTS ix_pay_invoice ON payments(invoice_id);

-- Admissions, promotion history
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY, app_no TEXT UNIQUE NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL, gender TEXT, dob TEXT,
  applying_for TEXT, previous_school TEXT, previous_results TEXT, guardian_name TEXT, guardian_phone TEXT, guardian_email TEXT, address TEXT,
  status TEXT DEFAULT 'Submitted', interview_date TEXT, notes TEXT, student_id INTEGER REFERENCES students(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS enrollment_history (
  id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id), year_name TEXT, from_class TEXT, to_class TEXT,
  action TEXT NOT NULL, average REAL, decided_by INTEGER, at TEXT DEFAULT CURRENT_TIMESTAMP);

-- Teaching & learning
CREATE TABLE IF NOT EXISTS homework (
  id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id), subject_id INTEGER NOT NULL REFERENCES subjects(id),
  title TEXT NOT NULL, description TEXT, assigned_on TEXT, due_on TEXT, created_by INTEGER);
CREATE TABLE IF NOT EXISTS syllabus_topics (
  id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id), subject_id INTEGER NOT NULL REFERENCES subjects(id),
  term_id INTEGER REFERENCES terms(id), unit TEXT NOT NULL, status TEXT DEFAULT 'Not started', covered_on TEXT, teacher_id INTEGER);

-- Staff performance
CREATE TABLE IF NOT EXISTS staff_reviews (
  id INTEGER PRIMARY KEY, staff_id INTEGER NOT NULL REFERENCES staff(id), period TEXT NOT NULL, rating INTEGER CHECK(rating BETWEEN 1 AND 5),
  strengths TEXT, improvements TEXT, reviewer_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);

-- Finance extras
CREATE TABLE IF NOT EXISTS payment_plans (
  id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id), due_on TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0), note TEXT);
CREATE TABLE IF NOT EXISTS statement_lines (
  id INTEGER PRIMARY KEY, batch TEXT NOT NULL, source TEXT, line_date TEXT, reference TEXT, description TEXT, amount INTEGER NOT NULL,
  status TEXT DEFAULT 'Unmatched', payment_id INTEGER REFERENCES payments(id), imported_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, category TEXT, contact TEXT, phone TEXT, email TEXT, tin TEXT);
CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY, po_no TEXT UNIQUE NOT NULL, supplier_id INTEGER NOT NULL REFERENCES suppliers(id), category TEXT NOT NULL,
  description TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0), status TEXT DEFAULT 'Draft', ordered_on TEXT, received_on TEXT,
  expense_id INTEGER REFERENCES expenses(id), created_by INTEGER, approved_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);

-- Transport, boarding, health
CREATE TABLE IF NOT EXISTS vehicles (id INTEGER PRIMARY KEY, plate TEXT UNIQUE NOT NULL, model TEXT, seats INTEGER, insurance_until TEXT, inspection_until TEXT);
CREATE TABLE IF NOT EXISTS transport_routes (
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, vehicle_id INTEGER REFERENCES vehicles(id), driver_id INTEGER REFERENCES staff(id),
  stops TEXT, morning_time TEXT, fee INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS student_transport (
  id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL UNIQUE REFERENCES students(id), route_id INTEGER NOT NULL REFERENCES transport_routes(id), stop TEXT);
CREATE TABLE IF NOT EXISTS dormitories (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, gender TEXT, capacity INTEGER NOT NULL, patron_id INTEGER REFERENCES staff(id));
CREATE TABLE IF NOT EXISTS dorm_allocations (
  id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL UNIQUE REFERENCES students(id), dorm_id INTEGER NOT NULL REFERENCES dormitories(id), bed TEXT, allocated_on TEXT);
CREATE TABLE IF NOT EXISTS health_records (
  id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id), date TEXT NOT NULL, record_type TEXT NOT NULL,
  details TEXT NOT NULL, action_taken TEXT, guardian_informed INTEGER DEFAULT 0, recorded_by INTEGER);

-- Communication & documents
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, channel TEXT NOT NULL, audience TEXT NOT NULL, subject TEXT, body TEXT NOT NULL, recipients INTEGER DEFAULT 0,
  status TEXT DEFAULT 'Queued', created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS message_recipients (
  id INTEGER PRIMARY KEY, message_id INTEGER NOT NULL REFERENCES messages(id), name TEXT, address TEXT NOT NULL, student_id INTEGER, status TEXT DEFAULT 'Queued');
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY, ref_no TEXT UNIQUE NOT NULL, doc_type TEXT NOT NULL, student_id INTEGER REFERENCES students(id),
  staff_id INTEGER REFERENCES staff(id), notes TEXT, issued_by INTEGER, issued_at TEXT DEFAULT CURRENT_TIMESTAMP);
`;

function open(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  migrate(db);
  const count = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  if (!count) seed(db);
  if (!db.prepare('SELECT COUNT(*) n FROM applications').get().n) seedExtras(db);
  return db;
}

// Columns added after the first release — safe to run on every start
function migrate(db) {
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  const u = cols('users');
  if (!u.includes('mfa_secret')) db.exec('ALTER TABLE users ADD COLUMN mfa_secret TEXT');
  if (!u.includes('mfa_enabled')) db.exec('ALTER TABLE users ADD COLUMN mfa_enabled INTEGER DEFAULT 0');
  if (!cols('sessions').includes('created_at')) db.exec('ALTER TABLE sessions ADD COLUMN created_at INTEGER');
}

function seedExtras(db) {
  const r = rng(7);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const int = (a, b) => a + Math.floor(r() * (b - a + 1));
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const plus = (n) => iso(new Date(today.getTime() + n * 864e5));
  const y = today.getFullYear();
  const students = db.prepare("SELECT id, class_id, gender, boarding FROM students WHERE status='Active'").all();
  const staffByTitle = (t) => db.prepare('SELECT id FROM staff WHERE job_title=?').all(t).map((x) => x.id);

  tx(db, () => {
    // Admissions pipeline
    const first = ['Keza', 'Hirwa', 'Isaro', 'Ganza', 'Teta', 'Shema', 'Iriza', 'Gisa', 'Mugabo', 'Ineza'];
    const last = ['Uwera', 'Kamanzi', 'Rukundo', 'Mukeshimana', 'Nsengiyumva', 'Uwamahoro'];
    const ap = db.prepare(`INSERT INTO applications(app_no,first_name,last_name,gender,dob,applying_for,previous_school,previous_results,guardian_name,guardian_phone,guardian_email,status,interview_date,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    ['Submitted', 'Submitted', 'Interview', 'Interview', 'Accepted', 'Accepted', 'Rejected', 'Submitted', 'Waitlisted', 'Accepted'].forEach((st, i) => {
      ap.run(`APP-${y}-${String(i + 1).padStart(4, '0')}`, pick(first), pick(last), pick(['M', 'F']), `${y - 12}-0${int(1, 9)}-1${int(0, 9)}`, pick(['S1', 'S1', 'S2', 'S3']),
        pick(['EP Kimironko', 'GS Remera', 'EP Kacyiru', 'Ecole Belge']), `${int(55, 92)}% (P6 national exam)`, `${pick(first)} ${pick(last)}`, `+25078${int(1000000, 9999999)}`,
        `family${i}@mail.demo`, st, st === 'Interview' ? plus(int(2, 8)) : null, iso(new Date(today.getTime() - int(1, 30) * 864e5)));
    });

    // Homework & syllabus
    const assignments = db.prepare('SELECT class_id, subject_id, teacher_id FROM teacher_assignments').all();
    const hw = db.prepare('INSERT INTO homework(class_id,subject_id,title,description,assigned_on,due_on) VALUES(?,?,?,?,?,?)');
    const titles = ['Exercise set', 'Reading & summary', 'Lab report', 'Revision questions', 'Short essay', 'Project draft'];
    assignments.filter(() => r() < 0.25).forEach((a) => hw.run(a.class_id, a.subject_id, pick(titles), 'Complete in your exercise book and submit on the due date.', plus(-int(1, 6)), plus(int(1, 9))));
    const sy = db.prepare('INSERT INTO syllabus_topics(class_id,subject_id,term_id,unit,status,covered_on,teacher_id) VALUES(?,?,3,?,?,?,?)');
    assignments.forEach((a) => {
      for (let u = 1; u <= 6; u++) {
        const done = r() < 0.75 - u * 0.08;
        sy.run(a.class_id, a.subject_id, `Unit ${u}`, done ? 'Covered' : u <= 4 && r() < 0.5 ? 'In progress' : 'Not started', done ? plus(-int(5, 50)) : null, a.teacher_id);
      }
    });

    // Staff reviews
    const rv = db.prepare('INSERT INTO staff_reviews(staff_id,period,rating,strengths,improvements,reviewer_id) VALUES(?,?,?,?,?,2)');
    staffByTitle('Teacher').forEach((id) => rv.run(id, `${y} Term 2`, int(3, 5), pick(['Well-prepared lessons', 'Strong classroom management', 'Good rapport with students']), pick(['Submit marks on time', 'Use more practical activities', 'Improve syllabus pacing'])));

    // Payment plans for some unpaid Term 3 invoices
    const unpaid = db.prepare(`SELECT i.id, i.amount - COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id=i.id AND p.reversed=0),0) bal FROM invoices i WHERE term_id=3`).all().filter((x) => x.bal > 0).slice(0, 8);
    const pp = db.prepare('INSERT INTO payment_plans(invoice_id,due_on,amount,note) VALUES(?,?,?,?)');
    unpaid.forEach((inv) => { const half = Math.round(inv.bal / 2000) * 1000; pp.run(inv.id, plus(-10), half, 'Instalment 1'); pp.run(inv.id, plus(20), inv.bal - half, 'Instalment 2'); });

    // Suppliers & purchase orders
    const sup = db.prepare('INSERT INTO suppliers(name,category,contact,phone,email,tin) VALUES(?,?,?,?,?,?)');
    [['Kigali Foods Ltd', 'Food & Catering'], ['Office Plus', 'Stationery'], ['BuildRight Co.', 'Maintenance'], ['LabEquip', 'Science'], ['MTN Rwanda', 'ICT'], ['Local Carpentry', 'Furniture']]
      .forEach(([n, c], i) => sup.run(n, c, `${pick(first)} ${pick(last)}`, `+25078${int(1000000, 9999999)}`, `sales@supplier${i}.demo`, `10${int(1000000, 9999999)}`));
    const po = db.prepare('INSERT INTO purchase_orders(po_no,supplier_id,category,description,amount,status,ordered_on) VALUES(?,?,?,?,?,?,?)');
    po.run(`PO-${y}-0001`, 2, 'Stationery', 'End-of-term exam paper (40 reams)', 280000, 'Draft', plus(-2));
    po.run(`PO-${y}-0002`, 4, 'Science', 'Chemistry reagents for S3 practicals', 640000, 'Approved', plus(-6));
    po.run(`PO-${y}-0003`, 6, 'Maintenance', '20 replacement desks', 900000, 'Received', plus(-15));

    // Unreconciled bank/MoMo lines for the reconciliation screen
    const st = db.prepare('INSERT INTO statement_lines(batch,source,line_date,reference,description,amount,status,payment_id) VALUES(?,?,?,?,?,?,?,?)');
    const recent = db.prepare("SELECT id, reference, amount, paid_on, method FROM payments WHERE reference IS NOT NULL AND reversed=0 ORDER BY paid_on DESC LIMIT 6").all();
    recent.forEach((p) => st.run(`DEMO-${y}`, p.method, p.paid_on, p.reference, 'School fees', p.amount, 'Matched', p.id));

    // Transport
    const vh = db.prepare('INSERT INTO vehicles(plate,model,seats,insurance_until,inspection_until) VALUES(?,?,?,?,?)');
    vh.run('RAD 123 A', 'Toyota Coaster', 30, plus(140), plus(60)); vh.run('RAE 456 B', 'Isuzu NQR Bus', 45, plus(25), plus(200));
    const driver = staffByTitle('Driver')[0] || null;
    const rt = db.prepare('INSERT INTO transport_routes(name,vehicle_id,driver_id,stops,morning_time,fee) VALUES(?,?,?,?,?,?)');
    rt.run('Kimironko – Remera', 1, driver, 'Kimironko market, Kibagabaga, Remera Giporoso', '06:30', 60000);
    rt.run('Kicukiro – Sonatubes', 2, driver, 'Kicukiro centre, Niboye, Sonatubes', '06:20', 55000);
    const stt = db.prepare('INSERT OR IGNORE INTO student_transport(student_id,route_id,stop) VALUES(?,?,?)');
    students.filter((s) => s.boarding === 'Day' && r() < 0.3).forEach((s) => stt.run(s.id, int(1, 2), pick(['Stop 1', 'Stop 2', 'Stop 3'])));

    // Boarding
    const dm = db.prepare('INSERT INTO dormitories(name,gender,capacity) VALUES(?,?,?)');
    dm.run('Akagera (Boys)', 'M', 40); dm.run('Nyungwe (Girls)', 'F', 40);
    const da = db.prepare('INSERT OR IGNORE INTO dorm_allocations(student_id,dorm_id,bed,allocated_on) VALUES(?,?,?,?)');
    let bedM = 0, bedF = 0;
    students.filter((s) => s.boarding === 'Boarding').forEach((s) => da.run(s.id, s.gender === 'M' ? 1 : 2, `Bed ${s.gender === 'M' ? ++bedM : ++bedF}`, `${y}-01-08`));

    // Health (restricted)
    const hr = db.prepare('INSERT INTO health_records(student_id,date,record_type,details,action_taken,guardian_informed) VALUES(?,?,?,?,?,?)');
    [['Clinic visit', 'Headache and mild fever', 'Paracetamol, rested 2 hours', 1], ['Allergy', 'Allergic to penicillin', 'Recorded on file, kitchen and staff informed', 1],
     ['Clinic visit', 'Sprained ankle during sports', 'Ice and bandage; referred to health centre', 1], ['Vaccination', 'HPV dose 2 (national campaign)', 'Administered by district team', 1],
     ['Clinic visit', 'Stomach ache', 'Observed, returned to class', 0]].forEach((h) => hr.run(pick(students).id, plus(-int(1, 40)), ...h));

    // Communication log
    const ms = db.prepare('INSERT INTO messages(channel,audience,subject,body,recipients,status,created_at) VALUES(?,?,?,?,?,?,?)');
    ms.run('SMS', 'All guardians', null, 'Dear parent, the general assembly is on Saturday at 9:00 in the main hall. — School office', students.length, 'Sent', `${plus(-3)} 08:00:00`);

    // Nurse account for the restricted health module
    const nurse = db.prepare("SELECT id, first_name||' '||last_name n FROM staff WHERE job_title='Nurse'").get();
    if (nurse && !db.prepare("SELECT 1 FROM users WHERE username='nurse'").get()) {
      db.prepare('INSERT INTO users(username,password_hash,role,full_name,staff_id) VALUES(?,?,?,?,?)').run('nurse', hashPassword('demo1234'), 'nurse', nurse.n, nurse.id);
    }
  });
}

function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

// ---------- Demo seed (illustrative data only, not a real school) ----------
function rng(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }

function seed(db) {
  const r = rng(42);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const int = (a, b) => a + Math.floor(r() * (b - a + 1));
  const iso = (d) => d.toISOString().slice(0, 10);
  const today = new Date();

  tx(db, () => {
    const set = db.prepare('INSERT INTO school_settings(key,value) VALUES(?,?)');
    [['school_name', 'Green Hills Academy (Demo)'], ['motto', 'Knowledge · Integrity · Service'], ['currency', 'RWF'],
     ['address', 'KG 123 St, Kigali, Rwanda'], ['phone', '+250 788 000 000'], ['pass_mark', '50']].forEach((x) => set.run(...x));

    const y = Number(today.getFullYear());
    db.prepare('INSERT INTO academic_years(id,name,is_current) VALUES(1,?,1)').run(`${y}`);
    const t = db.prepare('INSERT INTO terms(id,year_id,name,start_date,end_date,is_current) VALUES(?,?,?,?,?,?)');
    t.run(1, 1, 'Term 1', `${y}-01-08`, `${y}-04-04`, 0);
    t.run(2, 1, 'Term 2', `${y}-04-21`, `${y}-07-18`, 0);
    t.run(3, 1, 'Term 3', `${y}-09-01`, `${y}-12-05`, 1);

    const first = ['Aline', 'Eric', 'Divine', 'Jean', 'Grace', 'Patrick', 'Claudine', 'Olivier', 'Diane', 'Kevin', 'Sandrine', 'Yves',
      'Esther', 'Fabrice', 'Josiane', 'Emmanuel', 'Clarisse', 'Innocent', 'Ange', 'Thierry', 'Belise', 'Samuel', 'Gisele', 'David',
      'Liliane', 'Moise', 'Ariane', 'Elie', 'Nadine', 'Bruno'];
    const last = ['Uwase', 'Mugisha', 'Ishimwe', 'Niyonzima', 'Uwimana', 'Habimana', 'Mukamana', 'Nshimiyimana', 'Iradukunda',
      'Hakizimana', 'Ingabire', 'Tuyishime', 'Niyigena', 'Mutoni', 'Manzi', 'Gatete', 'Kayitesi', 'Bizimana', 'Umutoni', 'Nkurunziza'];

    // Staff
    const staffIns = db.prepare(`INSERT INTO staff(staff_no,first_name,last_name,gender,job_title,department,phone,email,qualification,salary,hired_on,contract_end)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    const staffDefs = [
      ['Director', 'Administration', 950000], ['Head Teacher', 'Administration', 780000], ['Bursar', 'Finance', 520000],
      ['HR Officer', 'Administration', 480000], ['School Administrator', 'Administration', 500000], ['ICT Officer', 'ICT', 450000],
      ['Teacher', 'Sciences', 380000], ['Teacher', 'Sciences', 380000], ['Teacher', 'Languages', 360000], ['Teacher', 'Languages', 360000],
      ['Teacher', 'Humanities', 350000], ['Teacher', 'Sciences', 390000], ['Teacher', 'ICT', 370000], ['Teacher', 'Humanities', 350000],
      ['Librarian', 'Library', 280000], ['Driver', 'Transport', 200000], ['Cook', 'Boarding', 180000], ['Nurse', 'Health', 320000]];
    staffDefs.forEach(([title, dept, sal], i) => {
      const f = pick(first), l = pick(last);
      staffIns.run(`STF${String(i + 1).padStart(3, '0')}`, f, l, pick(['M', 'F']), title, dept, `+25078${int(1000000, 9999999)}`,
        `${f.toLowerCase()}.${l.toLowerCase()}@school.demo`, title === 'Teacher' ? pick(['B.Ed', 'BSc + PGDE', 'A0 Education']) : pick(['Bachelor', 'Masters', 'A1 Diploma']),
        sal, `${y - int(1, 9)}-0${int(1, 9)}-15`, `${y + int(0, 3)}-12-31`);
    });
    const teacherIds = db.prepare("SELECT id FROM staff WHERE job_title='Teacher'").all().map((x) => x.id);

    // Classes & subjects
    const classIns = db.prepare('INSERT INTO classes(name,level,stream,class_teacher_id) VALUES(?,?,?,?)');
    const classNames = [['S1 A', 'S1', 'A'], ['S1 B', 'S1', 'B'], ['S2 A', 'S2', 'A'], ['S2 B', 'S2', 'B'], ['S3 A', 'S3', 'A'], ['S3 B', 'S3', 'B']];
    classNames.forEach(([n, l, s], i) => classIns.run(n, l, s, teacherIds[i % teacherIds.length]));
    const subjIns = db.prepare('INSERT INTO subjects(code,name,department) VALUES(?,?,?)');
    const subjects = [['MAT', 'Mathematics', 'Sciences'], ['ENG', 'English', 'Languages'], ['KIN', 'Kinyarwanda', 'Languages'],
      ['FRE', 'French', 'Languages'], ['PHY', 'Physics', 'Sciences'], ['CHE', 'Chemistry', 'Sciences'], ['BIO', 'Biology', 'Sciences'],
      ['HIS', 'History', 'Humanities'], ['GEO', 'Geography', 'Humanities'], ['ICT', 'Computer Science', 'ICT']];
    subjects.forEach((s) => subjIns.run(...s));
    const deptTeachers = (dept) => db.prepare("SELECT id FROM staff WHERE job_title='Teacher' AND department=?").all(dept).map((x) => x.id);
    const ta = db.prepare('INSERT INTO teacher_assignments(class_id,subject_id,teacher_id) VALUES(?,?,?)');
    for (let c = 1; c <= 6; c++) subjects.forEach((s, i) => { const ts = deptTeachers(s[2]); ta.run(c, i + 1, ts[(c + i) % ts.length]); });

    // Timetable: 5 days × 6 periods, conflict-free by rotating subject order per class
    const tt = db.prepare('INSERT OR IGNORE INTO timetable(class_id,day,period,subject_id,teacher_id,room) VALUES(?,?,?,?,?,?)');
    const busy = new Set();
    const assign = db.prepare('SELECT subject_id, teacher_id FROM teacher_assignments WHERE class_id=?');
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].forEach((day, d) => {
      for (let c = 1; c <= 6; c++) {
        const list = assign.all(c);
        for (let p = 1; p <= 6; p++) {
          for (let k = 0; k < list.length; k++) {
            const a = list[(p + d * 3 + c + k) % list.length];
            const key = `${day}-${p}-${a.teacher_id}`;
            if (!busy.has(key)) { busy.add(key); tt.run(c, day, p, a.subject_id, a.teacher_id, `Room ${c}`); break; }
          }
        }
      }
    });

    // Students
    const stIns = db.prepare(`INSERT OR IGNORE INTO students(adm_no,first_name,last_name,gender,dob,class_id,guardian_name,guardian_phone,guardian_email,address,emergency_contact,boarding,enrolled_on)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    let n = 0;
    for (let c = 1; c <= 6; c++) {
      for (let k = 0; k < 22; k++) {
        n++;
        const f = pick(first), l = pick(last), gl = pick(last);
        const age = 12 + Math.floor((c - 1) / 2);
        stIns.run(`${y}-${String(n).padStart(4, '0')}`, f, l, pick(['M', 'F']), `${y - age}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`,
          c, `${pick(first)} ${gl}`, `+25078${int(1000000, 9999999)}`, `parent${n}@mail.demo`, pick(['Gasabo', 'Kicukiro', 'Nyarugenge', 'Bugesera']),
          `+25073${int(1000000, 9999999)}`, pick(['Day', 'Day', 'Boarding']), `${y}-01-08`);
      }
    }
    const students = db.prepare('SELECT id, class_id FROM students').all();

    // Attendance for the last 25 school days
    const att = db.prepare('INSERT OR IGNORE INTO student_attendance(student_id,date,status) VALUES(?,?,?)');
    const satt = db.prepare('INSERT OR IGNORE INTO staff_attendance(staff_id,date,status) VALUES(?,?,?)');
    const days = [];
    for (let d = new Date(today), i = 0; days.length < 25 && i < 60; i++, d.setDate(d.getDate() - 1)) {
      if (d.getDay() !== 0 && d.getDay() !== 6) days.push(iso(d));
    }
    const chronic = new Set(students.filter(() => r() < 0.05).map((s) => s.id));
    days.forEach((date) => {
      students.forEach((s) => {
        const x = r();
        const absentP = chronic.has(s.id) ? 0.3 : 0.04;
        att.run(s.id, date, x < absentP ? 'A' : x < absentP + 0.04 ? 'L' : x < absentP + 0.05 ? 'E' : 'P');
      });
      for (let sid = 1; sid <= staffDefs.length; sid++) satt.run(sid, date, r() < 0.03 ? 'A' : r() < 0.05 ? 'L' : 'P');
    });

    // Assessments & marks (Term 2 complete, Term 3 CAT done)
    const asIns = db.prepare('INSERT INTO assessments(term_id,name,max_score) VALUES(?,?,?)');
    [[1, 'CAT', 40], [1, 'Exam', 60], [2, 'CAT', 40], [2, 'Exam', 60], [3, 'CAT', 40], [3, 'Exam', 60]].forEach((a) => asIns.run(...a));
    const mk = db.prepare('INSERT INTO marks(assessment_id,student_id,subject_id,score,approved) VALUES(?,?,?,?,1)');
    students.forEach((s) => {
      const ability = 0.35 + r() * 0.55;
      for (let subj = 1; subj <= subjects.length; subj++) {
        const bias = (r() - 0.5) * 0.25;
        [[1, 40], [2, 60], [3, 40], [4, 60], [5, 40]].forEach(([aid, max]) => {
          const p = Math.max(0.05, Math.min(1, ability + bias + (r() - 0.5) * 0.2));
          mk.run(aid, s.id, subj, Math.round(p * max));
        });
      }
    });

    // Finance: fee structures, invoices, payments, expenses, budgets
    const fs_ = db.prepare('INSERT INTO fee_structures(term_id,class_id,item,amount) VALUES(?,?,?,?)');
    [1, 2, 3].forEach((term) => { fs_.run(term, null, 'Tuition', 180000); fs_.run(term, null, 'Meals', 45000); fs_.run(term, null, 'Development fund', 25000); });
    const inv = db.prepare('INSERT INTO invoices(invoice_no,student_id,term_id,amount,issued_on,due_on) VALUES(?,?,?,?,?,?)');
    const pay = db.prepare('INSERT INTO payments(receipt_no,invoice_id,student_id,amount,method,reference,paid_on) VALUES(?,?,?,?,?,?,?)');
    let invNo = 0, rcNo = 0;
    const termStart = { 1: `${y}-01-08`, 2: `${y}-04-21`, 3: `${y}-09-01` };
    students.forEach((s) => {
      [1, 2, 3].forEach((term) => {
        const amount = 250000;
        const res = inv.run(`INV-${y}-${String(++invNo).padStart(5, '0')}`, s.id, term, amount, termStart[term], termStart[term].replace(/-(\d\d)$/, '-30'));
        const invoiceId = Number(res.lastInsertRowid);
        const share = term < 3 ? (r() < 0.9 ? 1 : 0.6 + r() * 0.3) : r() < 0.55 ? 1 : r() < 0.6 ? 0.5 : 0;
        let remaining = Math.round((amount * share) / 1000) * 1000;
        const parts = remaining > 0 ? int(1, 2) : 0;
        for (let p = 0; p < parts && remaining > 0; p++) {
          const a = p === parts - 1 ? remaining : Math.round(remaining / 2 / 1000) * 1000;
          remaining -= a;
          const method = pick(['Mobile Money', 'Bank', 'Bank', 'Cash']);
          const d = new Date(termStart[term]); d.setDate(d.getDate() + int(0, 40));
          if (d > today) d.setTime(today.getTime());
          rcNo++;
          pay.run(`RC-${y}-${String(rcNo).padStart(5, '0')}`, invoiceId, s.id, a, method,
            method === 'Cash' ? null : `${method === 'Bank' ? 'BK' : 'MM'}${100000 + rcNo}`, iso(d));
        }
      });
    });
    const ex = db.prepare("INSERT INTO expenses(category,description,supplier,amount,spent_on,status) VALUES(?,?,?,?,?,'Approved')");
    const cats = [['Food & Catering', 'Monthly food supplies', 'Kigali Foods Ltd', 2500000, 4200000], ['Utilities', 'Electricity & water', 'REG / WASAC', 600000, 900000],
      ['Maintenance', 'Classroom repairs', 'BuildRight Co.', 200000, 800000], ['Stationery', 'Exam papers & chalk', 'Office Plus', 150000, 450000],
      ['Transport', 'Bus fuel', 'SP Station', 300000, 600000], ['ICT', 'Internet subscription', 'MTN Rwanda', 250000, 250000]];
    for (let m = 0; m < 10; m++) {
      cats.forEach(([c, dsc, sup, lo, hi]) => {
        const d = new Date(y, m, int(1, 27));
        if (d <= today) ex.run(c, dsc, sup, Math.round(int(lo, hi) / 1000) * 1000, iso(d));
      });
    }
    db.prepare("INSERT INTO expenses(category,description,supplier,amount,spent_on,status) VALUES('Maintenance','Roof gutter replacement','BuildRight Co.',1450000,?,'Pending')").run(iso(today));
    const bud = db.prepare('INSERT INTO budgets(term_id,category,amount) VALUES(?,?,?)');
    [1, 2, 3].forEach((term) => cats.forEach(([c, , , lo, hi]) => bud.run(term, c, Math.round(((lo + hi) / 2) * 3.2 / 1000) * 1000)));

    // Payroll for last 3 months
    const pr = db.prepare("INSERT INTO payroll(month,staff_id,gross,deductions,net,status) VALUES(?,?,?,?,?,'Paid')");
    const staffRows = db.prepare('SELECT id, salary FROM staff').all();
    for (let m = 3; m >= 1; m--) {
      const d = new Date(today.getFullYear(), today.getMonth() - m, 1);
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      staffRows.forEach((s) => { const ded = Math.round(s.salary * 0.18); pr.run(month, s.id, s.salary, ded, s.salary - ded); });
    }

    // Library, inventory, discipline, leave
    const bk = db.prepare('INSERT INTO books(isbn,title,author,category,copies,shelf) VALUES(?,?,?,?,?,?)');
    [['978-0141439518', 'Pride and Prejudice', 'Jane Austen', 'Literature'], ['978-0385474542', 'Things Fall Apart', 'Chinua Achebe', 'Literature'],
     ['978-1108700191', 'Cambridge Mathematics S1', 'Cambridge', 'Textbook'], ['978-0198304722', 'Oxford Physics', 'Oxford', 'Textbook'],
     ['978-9997720011', 'Amateka y\'u Rwanda', 'REB', 'History'], ['978-0007120840', 'The Alchemist', 'Paulo Coelho', 'Literature'],
     ['978-0262033848', 'Introduction to Algorithms', 'Cormen et al.', 'ICT'], ['978-0199536016', 'Biology for Secondary', 'Oxford', 'Textbook'],
     ['978-2070360024', 'Le Petit Prince', 'A. de Saint-Exupéry', 'Literature'], ['978-0060935467', 'To Kill a Mockingbird', 'Harper Lee', 'Literature']]
      .forEach((b, i) => bk.run(...b, int(2, 12), `Shelf ${String.fromCharCode(65 + (i % 5))}`));
    const ln = db.prepare('INSERT INTO book_loans(book_id,student_id,borrowed_on,due_on,returned_on) VALUES(?,?,?,?,?)');
    for (let i = 0; i < 30; i++) {
      const b = new Date(today); b.setDate(b.getDate() - int(1, 30));
      const due = new Date(b); due.setDate(due.getDate() + 14);
      ln.run(int(1, 10), pick(students).id, iso(b), iso(due), r() < 0.5 ? iso(new Date(Math.min(due.getTime(), today.getTime()))) : null);
    }
    const inventory = db.prepare('INSERT INTO inventory(item,category,quantity,unit,location,condition,supplier,unit_cost) VALUES(?,?,?,?,?,?,?,?)');
    [['Desktop computers', 'ICT', 40, 'pcs', 'Computer Lab', 'Good', 'Positivo BGH', 450000], ['Projectors', 'ICT', 6, 'pcs', 'Store', 'Good', 'Office Plus', 380000],
     ['Student desks', 'Furniture', 280, 'pcs', 'Classrooms', 'Fair', 'Local Carpentry', 45000], ['Chalk boxes', 'Stationery', 12, 'boxes', 'Store', 'Good', 'Office Plus', 3500],
     ['Rice', 'Food', 850, 'kg', 'Kitchen store', 'Good', 'Kigali Foods Ltd', 1200], ['Beds', 'Boarding', 120, 'pcs', 'Dormitories', 'Good', 'Local Carpentry', 85000],
     ['Lab microscopes', 'Science', 10, 'pcs', 'Science Lab', 'Good', 'LabEquip', 210000]].forEach((x) => inventory.run(...x));
    const dis = db.prepare('INSERT INTO discipline(student_id,date,incident,action_taken,status) VALUES(?,?,?,?,?)');
    [['Late to class repeatedly', 'Verbal warning', 'Closed'], ['Uniform not respected', 'Parent informed', 'Closed'], ['Missed evening prep', 'Counselling', 'Open']]
      .forEach(([inc, act, st]) => { const d = new Date(today); d.setDate(d.getDate() - int(1, 20)); dis.run(pick(students).id, iso(d), inc, act, st); });
    const lv = db.prepare('INSERT INTO leave_requests(staff_id,leave_type,start_date,end_date,reason,status) VALUES(?,?,?,?,?,?)');
    lv.run(teacherIds[1], 'Sick', iso(today), iso(new Date(today.getTime() + 2 * 864e5)), 'Medical appointment', 'Pending');
    lv.run(teacherIds[3], 'Annual', iso(new Date(today.getTime() + 20 * 864e5)), iso(new Date(today.getTime() + 27 * 864e5)), 'Family visit', 'Pending');
    lv.run(teacherIds[0], 'Permission', iso(new Date(today.getTime() - 10 * 864e5)), iso(new Date(today.getTime() - 10 * 864e5)), 'Workshop', 'Approved');

    // Communication & calendar
    const an = db.prepare('INSERT INTO announcements(title,body,audience,pinned) VALUES(?,?,?,?)');
    an.run('Term 3 examinations timetable', 'End of term examinations begin on 17 November. Students should collect their exam cards from the bursar after clearing fees.', 'All', 1);
    an.run('Parents\' meeting', 'All parents are invited to the general assembly on Saturday at 9:00 in the main hall.', 'Parents', 0);
    an.run('Staff briefing', 'Weekly staff briefing moved to Thursday 16:00.', 'Staff', 0);
    const ev = db.prepare('INSERT INTO events(title,date,end_date,category,description) VALUES(?,?,?,?,?)');
    const plus = (d) => iso(new Date(today.getTime() + d * 864e5));
    ev.run('Parents\' general assembly', plus(4), null, 'Meeting', 'Main hall, 9:00');
    ev.run('Science fair', plus(9), null, 'Event', 'Open to all classes');
    ev.run('End of Term 3 exams', plus(21), plus(30), 'Exam', 'All classes');
    ev.run('Heroes Day (public holiday)', `${y + 1}-02-01`, null, 'Holiday', '');
    ev.run('Term 3 closes', `${y}-12-05`, null, 'Term', '');

    // User accounts — one demo account per role (see README for the shared demo password)
    const u = db.prepare('INSERT INTO users(username,password_hash,role,full_name,staff_id,student_id) VALUES(?,?,?,?,?,?)');
    const pw = hashPassword('demo1234');
    const staffName = (id) => { const s = db.prepare('SELECT first_name||\' \'||last_name n FROM staff WHERE id=?').get(id); return s ? s.n : 'User'; };
    u.run('director', pw, 'director', staffName(1), 1, null);
    u.run('headteacher', pw, 'headteacher', staffName(2), 2, null);
    u.run('bursar', pw, 'bursar', staffName(3), 3, null);
    u.run('hr', pw, 'hr', staffName(4), 4, null);
    u.run('admin', pw, 'admin', staffName(5), 5, null);
    u.run('sysadmin', pw, 'sysadmin', staffName(6), 6, null);
    u.run('teacher', pw, 'teacher', staffName(teacherIds[0]), teacherIds[0], null);
    const st = db.prepare('SELECT id, first_name, last_name, guardian_name FROM students WHERE id=1').get();
    u.run('student', pw, 'student', `${st.first_name} ${st.last_name}`, null, st.id);
    const parent = u.run('parent', pw, 'parent', st.guardian_name, null, null);
    db.prepare('INSERT INTO guardian_links(user_id,student_id) VALUES(?,?)').run(Number(parent.lastInsertRowid), 1);
    db.prepare('INSERT INTO guardian_links(user_id,student_id) VALUES(?,?)').run(Number(parent.lastInsertRowid), 30);
  });
}

module.exports = { open, tx };
