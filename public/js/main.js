// App shell: sign-in, role-based navigation, router, command palette (Ctrl+K), theme, language, offline/sync status.
import { state, api, queue, t, esc, icon, toast, can, initials, localGet, localSet } from './core.js';
import * as V from './views.js';

const NAV = [
  ['Overview', [['Dashboard', '#/', 'home', 'dashboard'], ['My portal', '#/portal', 'user', 'portal']]],
  ['People', [['Students', '#/students', 'cap', 'students'], ['Staff', '#/staff', 'idcard', 'leave']]],
  ['Academics', [['Attendance', '#/attendance', 'check', 'attendance'], ['Marks & exams', '#/marks', 'clip', 'marks'], ['Timetable', '#/timetable', 'grid', 'timetable'], ['Academics', '#/academics', 'book', 'academics']]],
  ['Finance', [['Finance', '#/finance', 'money', 'finance'], ['Payroll', '#/payroll', 'wallet', 'payroll']]],
  ['Operations', [['Library', '#/library', 'library', 'library'], ['Inventory', '#/inventory', 'box', 'inventory'], ['Discipline', '#/discipline', 'flag', 'discipline']]],
  ['Communication', [['Announcements', '#/announcements', 'megaphone', 'announcements'], ['Calendar', '#/calendar', 'calendar', 'calendar']]],
  ['Insights', [['Reports', '#/reports', 'chart', 'reports']]],
  ['System', [['Users', '#/users', 'users', 'users'], ['Audit log', '#/audit', 'log', 'audit'], ['Settings', '#/settings', 'cog', 'dashboard']]],
];

const ROUTES = [
  [/^\/$/, V.dashboard], [/^\/portal$/, V.portal, 'portal'], [/^\/students$/, V.students, 'students'], [/^\/students\/(?<id>\d+)$/, V.studentProfile],
  [/^\/staff$/, V.staff, 'leave'], [/^\/academics$/, V.academics, 'academics'], [/^\/timetable$/, V.timetable, 'timetable'], [/^\/attendance$/, V.attendance, 'attendance'],
  [/^\/marks$/, V.marks, 'marks'], [/^\/reportcard\/(?<id>\d+)$/, V.reportCard], [/^\/finance$/, V.finance, 'finance'], [/^\/receipt\/(?<id>\d+)$/, V.receipt],
  [/^\/payroll$/, V.payroll, 'payroll'], [/^\/library$/, V.library, 'library'], [/^\/inventory$/, V.inventory, 'inventory'], [/^\/discipline$/, V.discipline, 'discipline'],
  [/^\/announcements$/, V.announcements, 'announcements'], [/^\/calendar$/, V.calendar, 'calendar'], [/^\/reports$/, V.reports, 'reports'],
  [/^\/users$/, V.users, 'users'], [/^\/audit$/, V.audit, 'audit'], [/^\/settings$/, V.settings],
];

const navItems = () => NAV.map(([g, items]) => [g, items.filter(([l, , , perm]) => can(perm) && !(l === 'Dashboard' && can('portal')))]).filter(([, items]) => items.length);
const $ = (s) => document.querySelector(s);

// ---------- Theme / language / font ----------
window.smisSetTheme = (v) => { localSet('smis.theme', v || ''); if (v) document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme; };
window.smisSetLang = (v) => { state.lang = v; localSet('smis.lang', v); document.documentElement.lang = v; if (state.user) { renderShell(); route(); } else renderLogin(); };
window.smisSetFont = (v) => { document.documentElement.style.fontSize = `${v}px`; localSet('smis.font', v); };
window.smisSetTheme(localGet('smis.theme'));
if (localGet('smis.font')) window.smisSetFont(localGet('smis.font'));

// ---------- Sign-in ----------
const DEMO = [['director', 'Director', 'chart'], ['headteacher', 'Head teacher', 'cap'], ['teacher', 'Teacher', 'clip'], ['bursar', 'Bursar', 'money'], ['hr', 'HR officer', 'idcard'], ['admin', 'Administrator', 'users'], ['parent', 'Parent', 'user'], ['student', 'Student', 'book'], ['sysadmin', 'System admin', 'shield']];
function renderLogin(msg) {
  document.body.className = 'is-login';
  $('#app').innerHTML = `
    <main class="login">
      <section class="login-hero">
        <div class="brand big">${icon('cap', 36)}<div><b>SMIS</b><span>School Management Information System</span></div></div>
        <h1>One platform for students, staff, academics, finance and parents.</h1>
        <ul class="hero-points">
          <li>${icon('check', 18)} Works in the browser, as an installed desktop app, and offline</li>
          <li>${icon('shield', 18)} Role-based access with full audit trail</li>
          <li>${icon('chart', 18)} Reports calculated from real records — export to Excel or PDF</li>
          <li>${icon('globe', 18)} English · Kinyarwanda · Français</li>
        </ul>
      </section>
      <section class="login-card">
        <div class="lang-switch">${[['en', 'EN'], ['rw', 'RW'], ['fr', 'FR']].map(([k, l]) => `<button class="${state.lang === k ? 'on' : ''}" data-lang="${k}">${l}</button>`).join('')}</div>
        <h2>${t('Sign in')}</h2>
        <p class="muted">Use the account given by your school.</p>
        <form id="login" autocomplete="on">
          <label class="field"><span>${t('Username')}</span><input name="username" autocomplete="username" required autofocus></label>
          <label class="field"><span>${t('Password')}</span><div class="pw"><input name="password" type="password" autocomplete="current-password" required><button type="button" class="icon-btn" id="showpw" aria-label="Show password">👁</button></div></label>
          <p class="form-error" ${msg ? '' : 'hidden'}>${esc(msg || '')}</p>
          <button class="btn primary block" type="submit">${t('Sign in')}</button>
        </form>
        <div class="demo"><p class="muted small">Demo accounts — tap a role to try it (password <code>demo1234</code>):</p>
          <div class="demo-grid">${DEMO.map(([u, l, ic]) => `<button class="demo-btn" data-u="${u}">${icon(ic, 18)}<span>${l}</span></button>`).join('')}</div></div>
      </section>
    </main>`;
  const form = $('#login');
  const submit = async () => {
    const b = form.querySelector('button[type=submit]'); b.disabled = true; b.classList.add('loading');
    try { await api('/login', { method: 'POST', body: Object.fromEntries(new FormData(form)) }); await boot(); }
    catch (e) { const er = form.querySelector('.form-error'); er.hidden = false; er.textContent = e.message; }
    finally { b.disabled = false; b.classList.remove('loading'); }
  };
  form.onsubmit = (e) => { e.preventDefault(); submit(); };
  $('#showpw').onclick = () => { const p = form.elements.password; p.type = p.type === 'password' ? 'text' : 'password'; };
  document.querySelectorAll('[data-lang]').forEach((b) => (b.onclick = () => window.smisSetLang(b.dataset.lang)));
  document.querySelectorAll('.demo-btn').forEach((b) => (b.onclick = () => { form.elements.username.value = b.dataset.u; form.elements.password.value = 'demo1234'; submit(); }));
}

// ---------- Shell ----------
function renderShell() {
  document.body.className = '';
  const groups = navItems();
  const mobile = groups.flatMap(([, i]) => i).slice(0, 4);
  $('#app').innerHTML = `
    <aside class="sidebar" id="sidebar">
      <a class="brand" href="#/">${icon('cap', 28)}<div><b>${esc(state.meta.school.school_name)}</b><span>SMIS</span></div></a>
      <nav aria-label="Main">${groups.map(([g, items]) => `<div class="nav-group"><h4>${t(g)}</h4>${items.map(([l, h, ic]) => `<a href="${h}" data-href="${h}">${icon(ic)}<span>${t(l)}</span></a>`).join('')}</div>`).join('')}</nav>
      <div class="side-foot"><span class="avatar sm">${initials(state.user.full_name)}</span><div><b>${esc(state.user.full_name)}</b><small>${esc(state.user.roleLabel)}</small></div><button class="icon-btn" id="logout" title="${t('Sign out')}" aria-label="${t('Sign out')}">${icon('logout', 18)}</button></div>
    </aside>
    <div class="scrim" id="scrim"></div>
    <div class="main">
      <header class="topbar">
        <button class="icon-btn only-mobile" id="menu" aria-label="Open menu">${icon('menu')}</button>
        <button class="searchbar" id="open-palette">${icon('search', 18)}<span>${t('Search')} students, receipts, pages…</span><kbd>Ctrl K</kbd></button>
        <div class="top-actions">
          <span class="net" id="net" title="Connection status"></span>
          <select class="lang-select" id="lang-top" aria-label="Language"><option value="en">EN</option><option value="rw">RW</option><option value="fr">FR</option></select>
          <button class="icon-btn" id="theme-toggle" aria-label="Toggle dark mode" title="Dark / light">${icon('moon', 18)}</button>
          <a class="avatar sm only-desktop" href="#/settings" title="${esc(state.user.full_name)}">${initials(state.user.full_name)}</a>
        </div>
      </header>
      <main id="view" class="view" tabindex="-1"></main>
    </div>
    <nav class="bottom-nav" aria-label="Quick">${mobile.map(([l, h, ic]) => `<a href="${h}" data-href="${h}">${icon(ic)}<span>${t(l)}</span></a>`).join('')}<button id="more">${icon('menu')}<span>More</span></button></nav>`;
  $('#logout').onclick = async () => {
    await api('/logout', { method: 'POST' }).catch(() => {}); state.user = null;
    // Shared office computers: drop cached API data so the next user cannot read it offline
    if (window.caches) caches.keys().then((ks) => ks.forEach((k) => caches.open(k).then((c) => c.keys().then((rs) => rs.filter((r) => r.url.includes('/api/')).forEach((r) => c.delete(r)))))); location.hash = '#/'; renderLogin(); };
  const toggleSide = (open) => document.body.classList.toggle('nav-open', open);
  $('#menu').onclick = () => toggleSide(true); $('#more').onclick = () => toggleSide(true); $('#scrim').onclick = () => toggleSide(false);
  $('#sidebar').addEventListener('click', (e) => { if (e.target.closest('a')) toggleSide(false); });
  $('#open-palette').onclick = openPalette;
  $('#lang-top').value = state.lang; $('#lang-top').onchange = (e) => window.smisSetLang(e.target.value);
  $('#theme-toggle').onclick = () => { const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches); window.smisSetTheme(dark ? 'light' : 'dark'); };
  updateNet();
}

function updateNet() {
  const el = $('#net'); if (!el) return;
  const pending = queue.all().length;
  const on = navigator.onLine;
  el.className = `net ${on ? (pending ? 'sync' : 'on') : 'off'}`;
  el.innerHTML = `${icon(on ? (pending ? 'sync' : 'wifi') : 'alert', 16)}<span>${on ? (pending ? `${pending} to sync` : t('Online')) : `${t('Offline')}${pending ? ` · ${pending} saved` : ''}`}</span>`;
  el.onclick = pending && on ? () => queue.flush() : null;
}
window.addEventListener('online', () => { updateNet(); toast('Back online — syncing…', 'info'); queue.flush(); });
window.addEventListener('offline', () => { updateNet(); toast('You are offline. Attendance and marks will be saved on this device.', 'info'); });
window.addEventListener('smis:queue', updateNet);
window.addEventListener('smis:logout', () => { if (state.user) { state.user = null; renderLogin('Your session expired. Please sign in again.'); } });

// ---------- Router ----------
async function route() {
  if (!state.user) return;
  const raw = location.hash.slice(1) || '/';
  const [path, qs] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  const view = $('#view');
  document.querySelectorAll('[data-href]').forEach((a) => { const h = a.dataset.href.slice(1); a.classList.toggle('active', h === '/' ? path === '/' : path.startsWith(h)); });
  for (const [re, fn, perm] of ROUTES) {
    const m = path.match(re);
    if (!m) continue;
    if (perm && !can(perm)) { view.innerHTML = `<div class="empty-state big">${icon('shield', 48)}<h2>Access restricted</h2><p>Your role (${esc(state.user.roleLabel)}) cannot open this page.</p><a class="btn primary" href="#/">Go to dashboard</a></div>`; return; }
    view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter');
    try { await fn(view, m.groups || {}, query); }
    catch (e) { view.innerHTML = `<div class="empty-state big">${icon('alert', 48)}<h2>Could not load this page</h2><p>${esc(e.message)}</p><a class="btn primary" href="#/">Back to dashboard</a></div>`; }
    view.focus({ preventScroll: true }); window.scrollTo(0, 0);
    return;
  }
  view.innerHTML = `<div class="empty-state big">${icon('search', 48)}<h2>Page not found</h2><a class="btn primary" href="#/">Dashboard</a></div>`;
}
window.addEventListener('hashchange', route);

// ---------- Command palette ----------
function openPalette() {
  if (document.querySelector('.palette')) return;
  const pages = navItems().flatMap(([g, items]) => items.map(([l, h, ic]) => ({ type: t(g), label: t(l), href: h, ic })));
  const actions = [
    can('attendance', 'w') && { type: 'Action', label: 'Take attendance', href: '#/attendance', ic: 'check' },
    can('marks', 'w') && { type: 'Action', label: 'Enter marks', href: '#/marks', ic: 'clip' },
    can('students', 'w') && { type: 'Action', label: 'Register a new student', href: '#/students?new=1', ic: 'plus' },
    can('finance', 'w') && { type: 'Action', label: 'Record a fee payment', href: '#/finance?tab=invoices', ic: 'money' },
    can('finance', 'w') && { type: 'Action', label: 'Record an expense', href: '#/finance?tab=expenses&new=1', ic: 'wallet' },
    can('announcements', 'w') && { type: 'Action', label: 'Post an announcement', href: '#/announcements?new=1', ic: 'megaphone' },
    can('reports') && { type: 'Action', label: 'Executive summary report', href: '#/reports?r=executive', ic: 'chart' },
    { type: 'Action', label: 'Toggle dark mode', run: () => $('#theme-toggle').click(), ic: 'moon' },
    { type: 'Action', label: t('Sign out'), run: () => $('#logout').click(), ic: 'logout' },
  ].filter(Boolean);
  const wrap = document.createElement('div');
  wrap.className = 'palette-backdrop';
  wrap.innerHTML = `<div class="palette" role="dialog" aria-label="Command palette"><label>${icon('search', 20)}<input placeholder="Type a name, admission no., receipt, or page…" aria-label="Search"></label><ul role="listbox"></ul><footer><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></footer></div>`;
  document.body.appendChild(wrap);
  const input = wrap.querySelector('input'), ul = wrap.querySelector('ul');
  let items = [], sel = 0, timer;
  const close = () => wrap.remove();
  const pick = (it) => { close(); if (it.run) it.run(); else location.hash = it.href; };
  const draw = () => { ul.innerHTML = items.length ? items.map((it, i) => `<li role="option" class="${i === sel ? 'sel' : ''}" data-i="${i}">${icon(it.ic || (it.type === 'Student' ? 'cap' : it.type === 'Staff' ? 'idcard' : it.type === 'Receipt' || it.type === 'Invoice' ? 'money' : 'book'), 18)}<div><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</div><span class="badge">${esc(it.type)}</span></li>`).join('') : '<li class="none">No matches</li>'; ul.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }); };
  const update = () => {
    const q = input.value.trim().toLowerCase();
    const local = [...actions, ...pages].filter((x) => !q || x.label.toLowerCase().includes(q) || x.type.toLowerCase().includes(q));
    items = local.slice(0, 12); sel = 0; draw();
    clearTimeout(timer);
    if (q.length >= 2) timer = setTimeout(async () => { try { const r = await api(`/search?q=${encodeURIComponent(q)}`); if (input.value.trim().toLowerCase() === q) { items = [...r, ...local].slice(0, 14); draw(); } } catch { /* offline */ } }, 180);
  };
  input.oninput = update;
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    else if (e.key === 'Enter' && items[sel]) pick(items[sel]);
    else if (e.key === 'Escape') close();
  };
  ul.onclick = (e) => { const li = e.target.closest('[data-i]'); if (li) pick(items[li.dataset.i]); };
  wrap.onclick = (e) => { if (e.target === wrap) close(); };
  update(); input.focus();
}
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && state.user) { e.preventDefault(); openPalette(); }
  if (e.key === '/' && state.user && !e.target.closest('input,textarea,select')) { e.preventDefault(); openPalette(); }
});

// ---------- Boot ----------
async function boot() {
  try {
    const me = await api('/me');
    state.user = me.user; state.perms = me.perms;
    state.meta = await api('/meta');
    renderShell();
    const portalUser = ['parent', 'student'].includes(state.user.role);
    if (portalUser && ['', '#', '#/'].includes(location.hash)) location.hash = '#/portal';
    else if (!location.hash || location.hash === '#') location.hash = '#/';
    await route();
    queue.flush();
  } catch (e) {
    if (e.status === 0) renderLogin('Cannot reach the school server. Check the network or start the SMIS desktop app.');
    else renderLogin();
  }
}

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__installPrompt = e; });
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => {});
document.documentElement.lang = state.lang;
boot();
