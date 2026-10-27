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
  nurse:       { label: 'School Nurse' },
};
// Accounts that can see money, salaries or system settings must use two-step sign-in once enabled
const PRIVILEGED = ['director', 'bursar', 'hr', 'sysadmin', 'admin'];

const ALL_STAFF = ['director', 'admin', 'bursar', 'headteacher', 'teacher', 'hr', 'sysadmin', 'nurse'];
const PERMS = {
  dashboard:     { r: Object.keys(ROLES), w: [] },
  students:      { r: ['director', 'admin', 'headteacher', 'teacher', 'bursar', 'sysadmin', 'nurse'], w: ['admin', 'headteacher', 'sysadmin'] },
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
  admissions:    { r: ['director', 'admin', 'headteacher'], w: ['admin', 'headteacher'] },
  promotion:     { r: ['director', 'headteacher', 'admin'], w: ['headteacher', 'admin'] },
  homework:      { r: [...ALL_STAFF, 'student', 'parent'], w: ['teacher', 'headteacher'] },
  syllabus:      { r: ['director', 'headteacher', 'teacher', 'admin'], w: ['teacher', 'headteacher'] },
  reviews:       { r: ['director', 'headteacher', 'hr'], w: ['headteacher', 'hr', 'director'] },
  procurement:   { r: ['director', 'bursar', 'admin'], w: ['bursar', 'admin'] },
  approve_po:    { r: ['director'], w: ['director'] },
  transport:     { r: ['director', 'admin', 'bursar', 'headteacher'], w: ['admin'] },
  boarding:      { r: ['director', 'admin', 'headteacher', 'nurse'], w: ['admin', 'headteacher'] },
  health:        { r: ['nurse', 'headteacher'], w: ['nurse'] },
  messaging:     { r: ['director', 'admin', 'headteacher', 'bursar'], w: ['director', 'admin', 'headteacher', 'bursar'] },
  documents:     { r: ['director', 'admin', 'headteacher', 'bursar', 'hr'], w: ['director', 'admin', 'headteacher', 'bursar', 'hr'] },
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

// ---- TOTP two-step sign-in (RFC 6238, works with Google/Microsoft Authenticator) ----
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf) { let bits = 0, val = 0, out = ''; for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(val << (5 - bits)) & 31]; return out; }
function unbase32(s) { let bits = 0, val = 0; const out = []; for (const c of s.replace(/=+$/, '').toUpperCase()) { const i = B32.indexOf(c); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
const newTotpSecret = () => base32(crypto.randomBytes(20));
function totp(secret, step = Math.floor(Date.now() / 30000)) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
// Accept the previous/next 30-second window to tolerate clock drift
const verifyTotp = (secret, code) => { const s = Math.floor(Date.now() / 30000); return [-1, 0, 1].some((d) => totp(secret, s + d) === String(code || '').replace(/\s/g, '')); };

module.exports = { hashPassword, verifyPassword, newToken, ROLES, PRIVILEGED, PERMS, can, throttled, recordFail, clearFails, newTotpSecret, totp, verifyTotp };
