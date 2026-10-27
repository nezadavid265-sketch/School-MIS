// Core: API client with offline queue, state, i18n, formatting, UI building blocks, SVG charts.

export const state = { user: null, perms: {}, meta: null, lang: localGet('smis.lang') || 'en' };

function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } }
export { localGet, localSet };

// ---------------- API ----------------
export class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

export async function api(path, { method = 'GET', body, raw } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method, credentials: 'same-origin',
      headers: { 'X-Requested-With': 'smis', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'You are offline — cannot reach the school server');
  }
  if (raw) { if (!res.ok) throw new ApiError(res.status, 'Download failed'); return res; }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') { window.dispatchEvent(new Event('smis:logout')); }
  if (!res.ok) throw new ApiError(res.status, data.error || 'Request failed');
  return data;
}

// Offline queue for idempotent daily work (attendance, marks). Replayed automatically when back online.
const QKEY = 'smis.queue';
export const queue = {
  all() { try { return JSON.parse(localGet(QKEY) || '[]'); } catch { return []; } },
  add(item) { const q = queue.all(); q.push({ ...item, at: Date.now() }); localSet(QKEY, JSON.stringify(q)); window.dispatchEvent(new Event('smis:queue')); },
  async flush() {
    const q = queue.all(); if (!q.length || !navigator.onLine) return 0;
    const left = []; let sent = 0;
    for (const it of q) {
      try { await api(it.path, { method: 'POST', body: { ...it.body, offline: true } }); sent++; }
      catch (e) { if (e.status === 0 || e.status === 401) left.push(it); else toast(`Could not sync ${it.label}: ${e.message}`, 'error'); }
    }
    localSet(QKEY, JSON.stringify(left)); window.dispatchEvent(new Event('smis:queue'));
    if (sent) toast(`${sent} offline change(s) synced to the server`, 'success');
    return sent;
  },
};
// Save that falls back to the offline queue when the server is unreachable
export async function saveOrQueue(path, body, label) {
  try { return { ...(await api(path, { method: 'POST', body })), queued: false }; }
  catch (e) { if (e.status !== 0) throw e; queue.add({ path, body, label }); return { queued: true }; }
}

// ---------------- i18n ----------------
const DICT = {
  rw: { Dashboard: 'Ikibaho', 'My portal': 'Urubuga rwanjye', Students: 'Abanyeshuri', Staff: 'Abakozi', Academics: 'Amasomo', Timetable: 'Ingengabihe',
    Attendance: 'Kwitaba', 'Marks & exams': 'Amanota n\'ibizamini', Finance: 'Imari', Payroll: 'Imishahara', Library: 'Isomero', Inventory: 'Ibikoresho',
    Discipline: 'Imyitwarire', Announcements: 'Amatangazo', Calendar: 'Kalendari', Reports: 'Raporo', Users: 'Abakoresha', 'Audit log': 'Igenzura',
    Settings: 'Igenamiterere', Search: 'Shakisha', 'Sign out': 'Sohoka', Save: 'Bika', Cancel: 'Reka', Add: 'Ongeraho', Edit: 'Hindura', Delete: 'Siba',
    Overview: 'Incamake', People: 'Abantu', Operations: 'Ibikorwa', Communication: 'Itumanaho', Insights: 'Isesengura', System: 'Sisitemu',
    'Sign in': 'Injira', Username: 'Izina ukoresha', Password: 'Ijambobanga', Welcome: 'Murakaza neza', Present: 'Yaje', Absent: 'Ntiyaje', Late: 'Yakererewe',
    Excused: 'Yasabiye uruhushya', 'Mark all present': 'Bose baje', Export: 'Ohereza', Print: 'Capa', Class: 'Ishuri', Term: 'Igihembwe', Balance: 'Asigaye',
    'Fees collected': 'Amafaranga yishyuwe', 'Average attendance': 'Ikigereranyo cyo kwitaba', Online: 'Kuri murandasi', Offline: 'Nta murandasi', 'Report card': 'Indangamanota',
    Admissions: 'Kwakira abanyeshuri', 'Performance reviews': 'Isuzuma ry\'abakozi', Homework: 'Imikoro yo mu rugo', 'Syllabus coverage': 'Aho integanyanyigisho igeze',
    Promotion: 'Kwimuka', 'Payment plans': 'Gahunda yo kwishyura', Reconciliation: 'Guhuza konti', Procurement: 'Amasoko', Welfare: 'Imibereho',
    Boarding: 'Icumbi', Transport: 'Ingendo', Health: 'Ubuzima', Documents: 'Inyandiko', 'SMS & email': 'Ubutumwa' },
  fr: { Dashboard: 'Tableau de bord', 'My portal': 'Mon portail', Students: 'Élèves', Staff: 'Personnel', Academics: 'Scolarité', Timetable: 'Emploi du temps',
    Attendance: 'Présences', 'Marks & exams': 'Notes et examens', Finance: 'Finances', Payroll: 'Paie', Library: 'Bibliothèque', Inventory: 'Inventaire',
    Discipline: 'Discipline', Announcements: 'Annonces', Calendar: 'Calendrier', Reports: 'Rapports', Users: 'Utilisateurs', 'Audit log': 'Journal d\'audit',
    Settings: 'Paramètres', Search: 'Rechercher', 'Sign out': 'Déconnexion', Save: 'Enregistrer', Cancel: 'Annuler', Add: 'Ajouter', Edit: 'Modifier', Delete: 'Supprimer',
    Overview: 'Aperçu', People: 'Personnes', Operations: 'Opérations', Communication: 'Communication', Insights: 'Analyses', System: 'Système',
    'Sign in': 'Se connecter', Username: 'Nom d\'utilisateur', Password: 'Mot de passe', Welcome: 'Bienvenue', Present: 'Présent', Absent: 'Absent', Late: 'En retard',
    Excused: 'Excusé', 'Mark all present': 'Tous présents', Export: 'Exporter', Print: 'Imprimer', Class: 'Classe', Term: 'Trimestre', Balance: 'Solde',
    'Fees collected': 'Frais encaissés', 'Average attendance': 'Présence moyenne', Online: 'En ligne', Offline: 'Hors ligne', 'Report card': 'Bulletin',
    Admissions: 'Admissions', 'Performance reviews': 'Évaluations du personnel', Homework: 'Devoirs', 'Syllabus coverage': 'Avancement du programme',
    Promotion: 'Passage de classe', 'Payment plans': 'Échéanciers', Reconciliation: 'Rapprochement', Procurement: 'Achats', Welfare: 'Vie scolaire',
    Boarding: 'Internat', Transport: 'Transport', Health: 'Santé', Documents: 'Documents', 'SMS & email': 'SMS et e-mail' },
};
export const t = (s) => (DICT[state.lang] && DICT[state.lang][s]) || s;

// ---------------- Formatting ----------------
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (n) => `${Math.round(Number(n) || 0).toLocaleString('en-US')} ${state.meta?.school?.currency || 'RWF'}`;
export const num = (n) => (Number(n) || 0).toLocaleString('en-US');
export const pct = (n) => (n == null || Number.isNaN(Number(n)) ? '–' : `${Number(n).toFixed(1).replace(/\.0$/, '')}%`);
export const date = (d) => (d ? new Date(d.length <= 10 ? `${d}T00:00:00` : d.replace(' ', 'T') + (d.includes('T') || d.length <= 10 ? '' : 'Z')).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
export const today = () => new Date().toISOString().slice(0, 10);
export const initials = (name) => String(name || '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
export const label = (k) => String(k).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const gradeClass = (g) => ({ A: 'good', B: 'good', C: 'info', D: 'warn', E: 'warn', S: 'bad', F: 'bad' }[g] || '');
export const can = (mod, mode = 'r') => !!state.perms[mod]?.[mode];

// ---------------- Icons (inline SVG, offline-safe) ----------------
const P = {
  home: 'M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
  users: 'M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4zM8 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm8 2c-2.7 0-8 1.3-8 4v3h16v-3c0-2.7-5.3-4-8-4zM8 13c-.3 0-.7 0-1.1.1A4.7 4.7 0 0 1 9 17v3H0v-3c0-2.2 4.6-4 8-4z',
  cap: 'M12 3 1 9l11 6 9-4.9V17h2V9zM5 13.2v4L12 21l7-3.8v-4L12 17z',
  idcard: 'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm5 3a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zm-4 9h8c0-2-2-3-4-3s-4 1-4 3zm10-8v2h6V9zm0 4v2h4v-2z',
  book: 'M4 4h6a3 3 0 0 1 2 1 3 3 0 0 1 2-1h6v15h-6a2 2 0 0 0-2 2 2 2 0 0 0-2-2H4z',
  grid: 'M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
  clip: 'M9 2h6v2h3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3zm0 4v1h6V6zm-1 5v2h8v-2zm0 4v2h5v-2z',
  money: 'M2 6h20v12H2zm10 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM5 8a2 2 0 0 1-1 1v6a2 2 0 0 1 1 1h14a2 2 0 0 1 1-1V9a2 2 0 0 1-1-1z',
  wallet: 'M3 6a2 2 0 0 1 2-2h13v3h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm13 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  library: 'M4 3h3v18H4zm5 0h3v18H9zm5.2.6 2.9-.8 4.7 17.4-2.9.8z',
  box: 'M12 2 3 6.5v11L12 22l9-4.5v-11zm0 2.2 6.5 3.3L12 10.8 5.5 7.5zM5 9.2l6 3v7.3l-6-3z',
  flag: 'M5 21V4h10l1 2h5v9h-7l-1-2H7v8z',
  megaphone: 'M3 10v4a1 1 0 0 0 1 1h2l4 5h2V4h-2L6 9H4a1 1 0 0 0-1 1zm13-4v12a6 6 0 0 0 0-12zm0 3a3 3 0 0 1 0 6z',
  calendar: 'M7 2v2H4a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-3V2h-2v2H9V2zM5 9h14v10H5zm2 2v2h2v-2zm4 0v2h2v-2zm4 0v2h2v-2z',
  chart: 'M3 21V3h2v16h16v2zm4-4V10h3v7zm5 0V6h3v11zm5 0v-5h3v5z',
  shield: 'M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5zm-1 13-3.5-3.5 1.4-1.4L11 12.2l4.6-4.6L17 9z',
  log: 'M5 3h11l4 4v14H5zm2 6v2h10V9zm0 4v2h10v-2zm0 4v2h6v-2z',
  cog: 'M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.9a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.4-2.9a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
  search: 'M10 2a8 8 0 0 1 6.3 12.9l5.4 5.4-1.4 1.4-5.4-5.4A8 8 0 1 1 10 2zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z',
  plus: 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z',
  menu: 'M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z',
  moon: 'M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z',
  logout: 'M10 3h9a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-9v-2h8V5h-8zm-.6 5.4L11 7l5 5-5 5-1.4-1.4 2.6-2.6H3v-2h9.2z',
  print: 'M6 2h12v5H6zM4 8h16a2 2 0 0 1 2 2v7h-4v5H6v-5H2v-7a2 2 0 0 1 2-2zm4 8v4h8v-4z',
  download: 'M11 3h2v9.2l3.6-3.6L18 10l-6 6-6-6 1.4-1.4 3.6 3.6zM4 19h16v2H4z',
  alert: 'M12 2 1 21h22zm-1 7h2v6h-2zm0 8h2v2h-2z',
  x: 'M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z',
  wifi: 'M12 18a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM2 8.6a14.5 14.5 0 0 1 20 0l-1.5 1.5a12.4 12.4 0 0 0-17 0zm3.5 3.5a9.5 9.5 0 0 1 13 0L17 13.6a7.4 7.4 0 0 0-10 0zm3.5 3.5a4.5 4.5 0 0 1 6 0L13.5 17a2.4 2.4 0 0 0-3 0z',
  sync: 'M12 4a8 8 0 0 1 7.4 5H22l-3.5 4L15 9h2.2A6 6 0 0 0 6 11H4a8 8 0 0 1 8-7zm-6.5 7L9 15H6.8A6 6 0 0 0 18 13h2a8 8 0 0 1-15.4 2H2z',
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-3a15.6 15.6 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8zM12 4a13.8 13.8 0 0 1 1.9 4h-3.8A13.8 13.8 0 0 1 12 4zM4.3 14a8.2 8.2 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4zm.8 2h3a15.6 15.6 0 0 0 1.4 3.6A8 8 0 0 1 5.1 16zm3-8h-3a8 8 0 0 1 4.4-3.6A15.6 15.6 0 0 0 8.1 8zM12 20a13.8 13.8 0 0 1-1.9-4h3.8A13.8 13.8 0 0 1 12 20zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4zm.3 5.6a15.6 15.6 0 0 0 1.4-3.6h3a8 8 0 0 1-4.4 3.6zm1.7-5.6a16.5 16.5 0 0 0 0-4h3.4a8.2 8.2 0 0 1 0 4z',
  user: 'M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5zm0 2c-3.3 0-10 1.7-10 5v3h20v-3c0-3.3-6.7-5-10-5z',
  install: 'M4 4h16v11H4zm-2 13h20v2H2zm10-11v5.6l2.3-2.3 1.4 1.4L12 14.4l-3.7-3.7 1.4-1.4L12 11.6V6z',
  bus: 'M5 3h14a2 2 0 0 1 2 2v12a2 2 0 0 1-1 1.7V21h-3v-2H7v2H4v-2.3A2 2 0 0 1 3 17V5a2 2 0 0 1 2-2zm0 3v5h14V6zm2 8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm10 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  heart: 'M12 21s-8-5.1-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.9-8 11-8 11zm-1-12v2H9v2h2v2h2v-2h2v-2h-2V9z',
  bed: 'M3 6h2v7h6V8h8a3 3 0 0 1 3 3v8h-2v-2H5v2H3zm5 1.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  mail: 'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2.2V17h16V7.2l-8 5.3z',
  doc: 'M6 2h8l6 6v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm7 1.5V9h5.5zM8 12v2h8v-2zm0 4v2h8v-2z',
  truck: 'M2 5h12v10h1V8h4l3 4v5h-2a2.5 2.5 0 0 1-5 0H9a2.5 2.5 0 0 1-5 0H2zm15 5v2h3.5L19 10zM6.5 16a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm11 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
  bank: 'M12 2 2 7v2h20V7zM4 11v7h3v-7zm6.5 0v7h3v-7zM17 11v7h3v-7zM2 20h20v2H2z',
  key: 'M7 14a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm5.6-4A6 6 0 1 0 12.6 14H16v3h3v-3h2v-4z',
  inbox: 'M4 3h16l2 10v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-7zm1.6 2-1.4 7H9a3 3 0 0 0 6 0h4.8l-1.4-7z',
  up: 'M12 3 4 11l1.4 1.4L11 6.8V21h2V6.8l5.6 5.6L20 11z',
  pencil: 'M3 17.2V21h3.8L17.9 9.9l-3.8-3.8zm17.7-10.1a1 1 0 0 0 0-1.4l-2.4-2.4a1 1 0 0 0-1.4 0l-1.8 1.8 3.8 3.8z',
  star: 'm12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  map: 'M9 3 3 5v16l6-2 6 2 6-2V3l-6 2zm0 2.2 6 2v11.6l-6-2z',
};
export const icon = (name, size = 20) => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[name] || P.grid}"/></svg>`;

// ---------------- UI primitives ----------------
export function toast(msg, kind = 'info') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`; el.setAttribute('role', 'status');
  el.innerHTML = `${icon(kind === 'error' ? 'alert' : kind === 'success' ? 'check' : 'megaphone', 18)}<span>${esc(msg)}</span>`;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, kind === 'error' ? 6000 : 3500);
}

export function modal({ title, body, actions = '', wide = false, onOpen }) {
  const root = document.getElementById('modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></header>
    <div class="modal-body">${body}</div>${actions ? `<footer>${actions}</footer>` : ''}</div>`;
  const close = () => { wrap.classList.add('out'); setTimeout(() => wrap.remove(), 180); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  root.appendChild(wrap);
  const first = wrap.querySelector('input,select,textarea,button:not([data-close])');
  if (first) setTimeout(() => first.focus(), 30);
  if (onOpen) onOpen(wrap, close);
  return { el: wrap, close };
}

export function confirmBox(message, { okText = 'Confirm', danger = false, input } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title: 'Please confirm',
      body: `<p>${esc(message)}</p>${input ? `<label class="field"><span>${esc(input)}</span><input id="cb-input" required></label>` : ''}`,
      actions: `<button class="btn ghost" data-close>${t('Cancel')}</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cb-ok">${esc(okText)}</button>`,
      onOpen: (el, close) => {
        el.querySelector('#cb-ok').onclick = () => {
          const v = input ? el.querySelector('#cb-input').value.trim() : true;
          if (input && !v) return el.querySelector('#cb-input').focus();
          done = true; resolve(v); close();
        };
      },
    });
    new MutationObserver((_, o) => { if (!document.body.contains(m.el)) { o.disconnect(); if (!done) resolve(false); } }).observe(document.getElementById('modal-root'), { childList: true });
  });
}

// Field spec: { name, label, type: text|number|date|select|textarea|checkbox|email|tel|password, options: [[value,label]] | fn, required, full, help }
export function fieldHtml(f, v) {
  const val = v ?? f.default ?? '';
  const req = f.required ? 'required' : '';
  const common = `name="${f.name}" id="f-${f.name}" ${req} ${f.readonly ? 'readonly' : ''}`;
  let input;
  if (f.type === 'select') {
    const opts = typeof f.options === 'function' ? f.options() : f.options || [];
    input = `<select ${common}>${f.required ? '' : '<option value="">—</option>'}${opts.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  } else if (f.type === 'textarea') input = `<textarea ${common} rows="3">${esc(val)}</textarea>`;
  else if (f.type === 'checkbox') return `<label class="check ${f.full ? 'full' : ''}"><input type="checkbox" ${common} ${val && val !== '0' ? 'checked' : ''}><span>${esc(f.label)}</span></label>`;
  else input = `<input type="${f.type || 'text'}" ${common} value="${esc(val)}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} ${f.step ? `step="${f.step}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${f.list ? `list="dl-${f.name}"` : ''}>${f.list ? `<datalist id="dl-${f.name}">${f.list.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>` : ''}`;
  return `<label class="field ${f.full ? 'full' : ''}"><span>${esc(f.label)}${f.required ? ' <b class="req">*</b>' : ''}</span>${input}${f.help ? `<small>${esc(f.help)}</small>` : ''}</label>`;
}
export function readForm(form, fields) {
  const out = {};
  for (const f of fields) {
    const el = form.elements[f.name]; if (!el) continue;
    out[f.name] = f.type === 'checkbox' ? (el.checked ? 1 : 0) : f.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value.trim();
  }
  return out;
}

export function formModal({ title, fields, values = {}, submitText, onSubmit, wide }) {
  return modal({
    title, wide: wide ?? fields.length > 6,
    body: `<form class="form-grid" id="mform" novalidate>${fields.map((f) => fieldHtml(f, values[f.name])).join('')}<p class="form-error" hidden></p></form>`,
    actions: `<button class="btn ghost" data-close>${t('Cancel')}</button><button class="btn primary" form="mform" type="submit">${esc(submitText || t('Save'))}</button>`,
    onOpen: (el, close) => {
      const form = el.querySelector('form');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!form.checkValidity()) { form.reportValidity(); return; }
        const btn = el.querySelector('button[type=submit]'); btn.disabled = true; btn.classList.add('loading');
        const err = form.querySelector('.form-error');
        try { await onSubmit(readForm(form, fields), close); }
        catch (ex) { err.hidden = false; err.textContent = ex.message; }
        finally { btn.disabled = false; btn.classList.remove('loading'); }
      });
    },
  });
}

// Data table with sorting, quick filter, pagination, CSV/Excel export and print.
export function dataTable(container, { columns, rows, onRow, empty = 'No records found', exportName, pageSize = 25, toolbar = '', searchable = true }) {
  let sortKey = null, dir = 1, filter = '', page = 0;
  const cols = columns.map((c) => (typeof c === 'string' ? { key: c, label: label(c) } : c));
  const textOf = (c, r) => { const v = c.value ? c.value(r) : r[c.key]; return v == null ? '' : String(v); };
  function view() {
    let list = rows;
    if (filter) { const f = filter.toLowerCase(); list = list.filter((r) => cols.some((c) => textOf(c, r).toLowerCase().includes(f))); }
    if (sortKey) {
      const c = cols.find((x) => x.key === sortKey);
      list = [...list].sort((a, b) => { const x = c.value ? c.value(a) : a[c.key], y = c.value ? c.value(b) : b[c.key]; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true })) * dir; });
    }
    return list;
  }
  function render() {
    const list = view();
    const pages = Math.max(1, Math.ceil(list.length / pageSize)); page = Math.min(page, pages - 1);
    const slice = list.slice(page * pageSize, page * pageSize + pageSize);
    container.innerHTML = `
      <div class="table-tools">
        ${searchable ? `<label class="search-inline">${icon('search', 16)}<input type="search" placeholder="Filter ${num(rows.length)} rows…" value="${esc(filter)}" aria-label="Filter table"></label>` : '<span></span>'}
        <div class="tools-right">${toolbar}${exportName ? `<button class="btn ghost sm" data-exp="csv">${icon('download', 16)} CSV</button><button class="btn ghost sm" data-exp="xls">${icon('download', 16)} Excel</button>` : ''}</div>
      </div>
      <div class="table-wrap"><table class="table">
        <thead><tr>${cols.map((c) => `<th data-k="${c.key}" class="${c.num ? 'num' : ''} ${sortKey === c.key ? (dir > 0 ? 'asc' : 'desc') : ''}" tabindex="0" scope="col">${esc(c.label)}</th>`).join('')}</tr></thead>
        <tbody>${slice.length ? slice.map((r, i) => `<tr data-i="${page * pageSize + i}" ${onRow ? 'class="clickable" tabindex="0"' : ''}>${cols.map((c) => `<td class="${c.num ? 'num' : ''}" data-label="${esc(c.label)}">${c.html ? c.html(r) : esc(textOf(c, r))}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" class="empty">${esc(empty)}</td></tr>`}</tbody>
      </table></div>
      ${pages > 1 ? `<div class="pager"><button class="btn ghost sm" data-pg="-1" ${page === 0 ? 'disabled' : ''}>‹ Prev</button><span>Page ${page + 1} of ${pages} · ${num(list.length)} rows</span><button class="btn ghost sm" data-pg="1" ${page >= pages - 1 ? 'disabled' : ''}>Next ›</button></div>` : ''}`;
    const inp = container.querySelector('.search-inline input');
    if (inp) inp.oninput = (e) => { filter = e.target.value; page = 0; const pos = e.target.selectionStart; render(); const n = container.querySelector('.search-inline input'); n.focus(); n.setSelectionRange(pos, pos); };
    container.querySelectorAll('th').forEach((th) => { const go = () => { const k = th.dataset.k; dir = sortKey === k ? -dir : 1; sortKey = k; render(); }; th.onclick = go; th.onkeydown = (e) => e.key === 'Enter' && go(); });
    container.querySelectorAll('[data-pg]').forEach((b) => (b.onclick = () => { page += Number(b.dataset.pg); render(); }));
    container.querySelectorAll('[data-exp]').forEach((b) => (b.onclick = () => exportRows(exportName, cols, view(), b.dataset.exp)));
    if (onRow) container.querySelectorAll('tbody tr[data-i]').forEach((tr) => {
      const go = (e) => { if (e.target.closest('button,a,input,select')) return; onRow(list[Number(tr.dataset.i)], e); };
      tr.onclick = go; tr.onkeydown = (e) => e.key === 'Enter' && go(e);
    });
  }
  render();
  return { update(newRows) { rows = newRows; render(); } };
}

export function exportRows(name, cols, rows, fmt = 'csv') {
  const columns = cols.map((c) => (typeof c === 'string' ? { key: c, label: label(c) } : c));
  const val = (c, r) => { const v = c.export ? c.export(r) : c.value ? c.value(r) : r[c.key]; return v == null ? '' : v; };
  let blob, ext;
  if (fmt === 'xls') {
    const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1"><tr>${columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${columns.map((c) => `<td>${esc(val(c, r))}</td>`).join('')}</tr>`).join('')}</table></body></html>`;
    blob = new Blob([html], { type: 'application/vnd.ms-excel' }); ext = 'xls';
  } else {
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [columns.map((c) => q(c.label)).join(','), ...rows.map((r) => columns.map((c) => q(val(c, r))).join(','))].join('\r\n');
    blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }); ext = 'csv';
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${name}-${today()}.${ext}`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`Exported ${rows.length} rows to ${ext.toUpperCase()}`, 'success');
}

export const kpi = ({ label: l, value, sub, tone = '', ic = 'chart', href, spark }) => `
  <${href ? `a href="${href}"` : 'div'} class="kpi ${tone}">
    <div class="kpi-ic">${icon(ic, 22)}</div>
    <div class="kpi-body"><span class="kpi-label">${esc(l)}</span><strong class="kpi-value">${value}</strong>${sub ? `<span class="kpi-sub">${sub}</span>` : ''}</div>
    ${spark ? `<div class="kpi-spark">${sparkline(spark)}</div>` : ''}
  </${href ? 'a' : 'div'}>`;

export const badge = (text, tone = '') => `<span class="badge ${tone}">${esc(text)}</span>`;
export const statusTone = (s) => ({ Paid: 'good', Approved: 'good', Active: 'good', Returned: 'good', Closed: 'good', Present: 'good', Partial: 'warn', Pending: 'warn', 'On loan': 'info', Open: 'warn', Draft: 'info', Unpaid: 'bad', Rejected: 'bad', Overdue: 'bad', Withdrawn: 'bad', Left: 'bad', Reversed: 'bad' }[s] || '');
export const empty = (msg, ic = 'grid') => `<div class="empty-state">${icon(ic, 40)}<p>${esc(msg)}</p></div>`;
export const loading = () => '<div class="skeleton-grid">' + '<div class="skeleton"></div>'.repeat(6) + '</div>';

export function tabs(container, items, active, onChange) {
  container.innerHTML = `<div class="tabs" role="tablist">${items.map(([k, l]) => `<button role="tab" class="tab ${k === active ? 'active' : ''}" aria-selected="${k === active}" data-tab="${k}">${esc(l)}</button>`).join('')}</div>`;
  container.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { container.querySelectorAll('.tab').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-selected', x === b); }); onChange(b.dataset.tab); }));
}

// ---------------- Charts (pure SVG) ----------------
const SERIES = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)'];
const short = (n) => { const a = Math.abs(n); return a >= 1e6 ? `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e3 ? `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k` : String(Math.round(n * 10) / 10); };

export function barChart(data, { labelKey = 'label', series = ['value'], names, max, stacked = false, height = 240, format = short, unit = '' } = {}) {
  if (!data.length) return empty('No data for this period', 'chart');
  const W = Math.max(320, data.length * (stacked ? 46 : 26 * series.length + 22)), H = height, pad = { l: 44, r: 8, t: 12, b: 42 };
  const totals = data.map((d) => (stacked ? series.reduce((a, s) => a + (Number(d[s]) || 0), 0) : Math.max(...series.map((s) => Number(d[s]) || 0))));
  const top = max || niceMax(Math.max(...totals, 1));
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b, bw = iw / data.length;
  const y = (v) => pad.t + ih - (v / top) * ih;
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = (top / 4) * i; g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${pad.l - 6}" y="${y(v) + 4}" class="axis" text-anchor="end">${format(v)}${unit}</text>`; }
  data.forEach((d, i) => {
    const x0 = pad.l + i * bw;
    if (stacked) {
      let acc = 0; const w = Math.min(34, bw * 0.6);
      series.forEach((s, k) => { const v = Number(d[s]) || 0; g += `<rect x="${x0 + (bw - w) / 2}" y="${y(acc + v)}" width="${w}" height="${Math.max(0, y(acc) - y(acc + v))}" fill="${SERIES[k]}" rx="2"><title>${esc(d[labelKey])} · ${esc((names || series)[k])}: ${num(v)}${unit}</title></rect>`; acc += v; });
    } else {
      const w = Math.min(22, (bw * 0.8) / series.length);
      const start = x0 + (bw - w * series.length - 2 * (series.length - 1)) / 2;
      series.forEach((s, k) => { const v = Number(d[s]) || 0; g += `<rect class="bar" x="${start + k * (w + 2)}" y="${y(v)}" width="${w}" height="${Math.max(0, y(0) - y(v))}" fill="${SERIES[k]}" rx="3"><title>${esc(d[labelKey])} · ${esc((names || series)[k])}: ${num(v)}${unit}</title></rect>`; });
    }
    const lab = String(d[labelKey]); g += `<text x="${x0 + bw / 2}" y="${H - pad.b + 16}" class="axis" text-anchor="middle">${esc(lab.length > 9 ? lab.slice(0, 8) + '…' : lab)}</text>`;
  });
  const legend = series.length > 1 ? `<div class="legend">${series.map((s, k) => `<span><i style="background:${SERIES[k]}"></i>${esc(label((names || series)[k]))}</span>`).join('')}</div>` : '';
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">${g}</svg>${legend}</div>`;
}

export function lineChart(data, { labelKey = 'label', series = ['value'], names, height = 220, max, unit = '', format = short } = {}) {
  if (!data.length) return empty('No data yet', 'chart');
  const W = 560, H = height, pad = { l: 44, r: 12, t: 12, b: 36 };
  const top = max || niceMax(Math.max(...data.flatMap((d) => series.map((s) => Number(d[s]) || 0)), 1));
  const min = max === 100 ? Math.max(0, Math.floor(Math.min(...data.flatMap((d) => series.map((s) => Number(d[s]) || 0))) / 10) * 10 - 10) : 0;
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const x = (i) => pad.l + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v) => pad.t + ih - ((v - min) / (top - min)) * ih;
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = min + ((top - min) / 4) * i; g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${pad.l - 6}" y="${y(v) + 4}" class="axis" text-anchor="end">${format(v)}${unit}</text>`; }
  series.forEach((s, k) => {
    const pts = data.map((d, i) => `${x(i)},${y(Number(d[s]) || 0)}`);
    g += `<path d="M${pts.join(' L')} L${x(data.length - 1)},${y(min)} L${x(0)},${y(min)} Z" fill="${SERIES[k]}" opacity=".10"/>`;
    g += `<polyline points="${pts.join(' ')}" fill="none" stroke="${SERIES[k]}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    data.forEach((d, i) => { g += `<circle cx="${x(i)}" cy="${y(Number(d[s]) || 0)}" r="3.5" fill="var(--surface)" stroke="${SERIES[k]}" stroke-width="2"><title>${esc(d[labelKey])}: ${num(d[s])}${unit}</title></circle>`; });
  });
  const step = Math.ceil(data.length / 7);
  data.forEach((d, i) => { if (i % step === 0 || i === data.length - 1) g += `<text x="${x(i)}" y="${H - 12}" class="axis" text-anchor="middle">${esc(String(d[labelKey]).slice(5) || d[labelKey])}</text>`; });
  const legend = series.length > 1 ? `<div class="legend">${series.map((s, k) => `<span><i style="background:${SERIES[k]}"></i>${esc(label((names || series)[k]))}</span>`).join('')}</div>` : '';
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg>${legend}</div>`;
}

export function donut(data, { size = 160, center, fmt = num } = {}) {
  const total = data.reduce((a, b) => a + (Number(b.value) || 0), 0);
  if (!total) return empty('No data yet', 'chart');
  const r = 60, c = 2 * Math.PI * r; let off = 0;
  const arcs = data.map((d, i) => { const len = (d.value / total) * c; const s = `<circle r="${r}" cx="80" cy="80" fill="none" stroke="${SERIES[i % 5]}" stroke-width="20" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 80 80)"><title>${esc(d.label)}: ${fmt(d.value)}</title></circle>`; off += len; return s; }).join('');
  return `<div class="donut"><svg viewBox="0 0 160 160" width="${size}" height="${size}" role="img">${arcs}<text x="80" y="78" text-anchor="middle" class="donut-v">${center ?? short(total)}</text><text x="80" y="96" text-anchor="middle" class="axis">total</text></svg>
    <ul class="legend col">${data.map((d, i) => `<li><i style="background:${SERIES[i % 5]}"></i>${esc(d.label)}<b>${Math.round((d.value / total) * 100)}%</b></li>`).join('')}</ul></div>`;
}

export function meter(value, { tone } = {}) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const tn = tone || (v >= 85 ? 'good' : v >= 65 ? 'warn' : 'bad');
  return `<div class="meter ${tn}" role="meter" aria-valuenow="${v}" aria-valuemin="0" aria-valuemax="100"><span style="width:${v}%"></span></div>`;
}

export function sparkline(values) {
  if (!values || values.length < 2) return '';
  const max = Math.max(...values), min = Math.min(...values), W = 80, H = 28;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * W},${H - 2 - ((v - min) / (max - min || 1)) * (H - 4)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }

// ---------------- Option helpers from metadata ----------------
export const opt = {
  classes: () => (state.meta?.classes || []).map((c) => [c.id, c.name]),
  myClasses: () => (state.meta?.classes || []).filter((c) => !state.meta.myClasses || state.meta.myClasses.includes(c.id)).map((c) => [c.id, c.name]),
  subjects: () => (state.meta?.subjects || []).map((s) => [s.id, s.name]),
  terms: () => (state.meta?.terms || []).map((x) => [x.id, `${x.name} ${x.year}`]),
  staff: () => (state.meta?.staff || []).map((s) => [s.id, `${s.name} — ${s.job_title}`]),
  teachers: () => (state.meta?.staff || []).filter((s) => s.job_title === 'Teacher' || s.job_title === 'Head Teacher').map((s) => [s.id, s.name]),
  roles: () => Object.entries(state.meta?.roles || {}).map(([k, v]) => [k, v.label]),
  list: (...xs) => xs.map((x) => [x, x]),
};
export const className = (id) => (state.meta?.classes || []).find((c) => c.id == id)?.name || '–';
export const currentTermId = () => state.meta?.currentTerm?.id;
