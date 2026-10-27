// Password hashing, tokens, role permissions and login throttling.
const crypto = require('node:crypto');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

const newToken = () => crypto.randomBytes(32).toString('hex');

// Role → which modules can be read (r) or changed (w).
const ROLES = {
  director:    { label: 'School Director' },
  admin:       { label: 'School Administrator' },
  bursar:      { label: 'Accountant / Bursar' },
  headteacher: { label: 'Head Teacher' },
  teacher:     { label: 'Teacher' },
  hr:          { label: 'HR Officer' },
  parent:      { label: 'Parent / Guardian' },
  student:     { label: 'Student' },
  sysadmin:    { label: 'System Administrator' },
};

const ALL_STAFF = ['director', 'admin', 'bursar', 'headteacher', 'teacher', 'hr', 'sysadmin'];
const PERMS = {
  dashboard:     { r: Object.keys(ROLES), w: [] },
  students:      { r: ['director', 'admin', 'headteacher', 'teacher', 'bursar', 'sysadmin'], w: ['admin', 'headteacher', 'sysadmin'] },
  staff:         { r: ['director', 'admin', 'headteacher', 'hr', 'sysadmin'], w: ['admin', 'hr', 'sysadmin'] },
  salaries:      { r: ['director', 'hr', 'bursar', 'sysadmin'], w: ['hr'] },
  leave:         { r: ALL_STAFF, w: ['hr', 'headteacher', 'director'] },
  academics:     { r: ['director', 'admin', 'headteacher', 'teacher', 'sysadmin'], w: ['admin', 'headteacher', 'sysadmin'] },
  marks:         { r: ['director', 'headteacher', 'teacher', 'admin'], w: ['teacher', 'headteacher'] },
  approve_marks: { r: ['headteacher', 'director'], w: ['headteacher', 'director'] },
  attendance:    { r: ['director', 'admin', 'headteacher', 'teacher', 'sysadmin'], w: ['teacher', 'headteacher', 'admin'] },
  staff_attendance: { r: ['director', 'admin', 'headteacher', 'hr'], w: ['hr', 'admin', 'headteacher'] },
  timetable:     { r: [...ALL_STAFF, 'student', 'parent'], w: ['admin', 'headteacher'] },
  finance:       { r: ['director', 'bursar', 'sysadmin'], w: ['bursar'] },
  approve_expense: { r: ['director'], w: ['director'] },
  payroll:       { r: ['director', 'hr', 'bursar'], w: ['hr', 'bursar'] },
  library:       { r: [...ALL_STAFF, 'student'], w: ['admin', 'sysadmin'] },
  inventory:     { r: ['director', 'admin', 'bursar', 'sysadmin'], w: ['admin', 'bursar'] },
  discipline:    { r: ['director', 'admin', 'headteacher', 'teacher'], w: ['headteacher', 'admin', 'teacher'] },
  announcements: { r: Object.keys(ROLES), w: ['director', 'admin', 'headteacher'] },
  calendar:      { r: Object.keys(ROLES), w: ['director', 'admin', 'headteacher'] },
  reports:       { r: ['director', 'headteacher', 'bursar', 'hr', 'admin'], w: [] },
  users:         { r: ['sysadmin'], w: ['sysadmin'] },
  audit:         { r: ['sysadmin', 'director'], w: [] },
  settings:      { r: ['sysadmin', 'director'], w: ['sysadmin'] },
  portal:        { r: ['parent', 'student'], w: [] },
};

const can = (role, mod, mode = 'r') => !!PERMS[mod] && PERMS[mod][mode].includes(role);

// Simple in-memory throttle: 8 failed logins per 10 minutes per IP+username.
const attempts = new Map();
function throttled(key) {
  const now = Date.now(); const a = attempts.get(key);
  if (!a || now - a.first > 10 * 60e3) return false;
  return a.count >= 8;
}
function recordFail(key) {
  const now = Date.now(); const a = attempts.get(key);
  if (!a || now - a.first > 10 * 60e3) attempts.set(key, { first: now, count: 1 }); else a.count++;
}
const clearFails = (key) => attempts.delete(key);

module.exports = { hashPassword, verifyPassword, newToken, ROLES, PERMS, can, throttled, recordFail, clearFails };
