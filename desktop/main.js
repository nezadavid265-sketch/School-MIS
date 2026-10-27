// SMIS desktop shell (Electron).
// Two modes, chosen from the "SMIS" menu and remembered in config.json:
//   • School server — this computer runs the database + server; other computers/phones on the
//     school network connect to it in a browser (works with no internet).
//   • Connect to server — this computer is a client of a central SMIS server (LAN or online).
const { app, BrowserWindow, Menu, dialog, shell, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

const CONFIG = path.join(app.getPath('userData'), 'config.json');
const readConfig = () => { try { return { mode: 'server', port: 3000, serverUrl: '', ...JSON.parse(fs.readFileSync(CONFIG, 'utf8')) }; } catch { return { mode: 'server', port: 3000, serverUrl: '' }; } };
const writeConfig = (c) => { fs.mkdirSync(path.dirname(CONFIG), { recursive: true }); fs.writeFileSync(CONFIG, JSON.stringify(c, null, 2)); };

let win, child, server;
const lan = () => Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);

async function startLocalServer(port) {
  const dbFile = path.join(app.getPath('userData'), 'smis.db');
  process.env.SMIS_DB = dbFile;
  try {
    // Preferred: run inside Electron's own Node runtime (needs node:sqlite support)
    const { createServer } = require('../server/server.js');
    server = createServer({ dbFile });
    await new Promise((res, rej) => { server.once('error', rej); server.listen(port, '0.0.0.0', res); });
  } catch (e) {
    // Fallback: system Node.js 22.5+ if installed
    child = spawn('node', [path.join(__dirname, '..', 'server', 'server.js')], { env: { ...process.env, PORT: String(port), SMIS_DB: dbFile }, stdio: 'ignore', windowsHide: true });
    await new Promise((r) => setTimeout(r, 1500));
    if (child.exitCode !== null) throw new Error(`Could not start the SMIS server (${e.message}). Install Node.js 22.5+ or switch to "Connect to server".`);
  }
  return `http://localhost:${port}`;
}

function buildMenu(cfg) {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'SMIS', submenu: [
      { label: cfg.mode === 'server' ? '✓ Mode: School server (this computer)' : 'Use this computer as the school server', click: () => switchMode({ ...cfg, mode: 'server' }) },
      { label: cfg.mode === 'client' ? `✓ Mode: Connected to ${cfg.serverUrl}` : 'Connect to another SMIS server…', click: askServerUrl },
      { type: 'separator' },
      { label: 'Copy school network address', enabled: cfg.mode === 'server', click: () => { const a = lan().map((ip) => `http://${ip}:${cfg.port}`).join('  '); clipboard.writeText(a); dialog.showMessageBox(win, { message: 'Other computers and phones on the school Wi-Fi can open:', detail: a || 'No network connection found.' }); } },
      { label: 'Open in web browser', click: () => shell.openExternal(win.webContents.getURL()) },
      { label: 'Show data folder (for backups)', click: () => shell.openPath(app.getPath('userData')) },
      { type: 'separator' }, { role: 'quit' },
    ] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'toggleDevTools' }] },
  ]));
}

async function askServerUrl() {
  // Electron has no prompt(); use a tiny inline page
  const p = new BrowserWindow({ parent: win, modal: true, width: 460, height: 220, resizable: false, minimizable: false, webPreferences: { contextIsolation: true } });
  p.setMenu(null);
  const cfg = readConfig();
  p.loadURL(`data:text/html,${encodeURIComponent(`<body style="font-family:Segoe UI,sans-serif;padding:18px"><h3 style="margin:0 0 10px">SMIS server address</h3><form onsubmit="document.title='url:'+document.getElementById('u').value;return false"><input id="u" style="width:100%;padding:8px" placeholder="http://192.168.1.10:3000 or https://smis.myschool.rw" value="${cfg.serverUrl || ''}" autofocus><p><button style="padding:8px 16px">Connect</button></p></form></body>`)}`);
  p.on('page-title-updated', (_e, title) => { if (title.startsWith('url:')) { const url = title.slice(4).trim().replace(/\/$/, ''); p.close(); if (/^https?:\/\//.test(url)) switchMode({ ...cfg, mode: 'client', serverUrl: url }); } });
}

function switchMode(cfg) { writeConfig(cfg); app.relaunch(); app.exit(0); }

async function createWindow() {
  const cfg = readConfig();
  win = new BrowserWindow({ width: 1360, height: 860, minWidth: 380, title: 'SMIS', backgroundColor: '#0f6b5c', webPreferences: { contextIsolation: true, sandbox: true } });
  buildMenu(cfg);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  try {
    const url = cfg.mode === 'client' && cfg.serverUrl ? cfg.serverUrl : await startLocalServer(cfg.port);
    await win.loadURL(url);
  } catch (e) {
    const r = await dialog.showMessageBox(win, { type: 'error', message: 'SMIS could not start', detail: e.message, buttons: ['Connect to a server…', 'Quit'] });
    if (r.response === 0) askServerUrl(); else app.quit();
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (server) server.close(); if (child) child.kill(); app.quit(); });
