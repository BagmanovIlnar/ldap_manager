import { api, getCreds, setCreds } from './api.js?v=4';
import './wc-login.js?v=4';
import './wc-grid.js?v=4';
import './wc-entry.js?v=5';
import './wc-group.js?v=6';
import './wc-memberof.js?v=5';

const $ = (id) => document.getElementById(id);
const login = $('login'), main = $('app'), who = $('who'),
      grid = $('grid'), dlgEntry = $('dlg-entry'), dlgCreate = $('dlg-create'),
      dlgPassword = $('dlg-password'),
      entry = $('entry'), group = $('group'), memberof = $('memberof'), centry = $('centry');

let me = null;        // WhoAmI после успешного входа
let gridInit = false; // грид получает base_dn один раз
let pwTarget = null;
let pendingHash = null; // адрес, запрошенный до входа

// ---------- маршруты: #/login • #/ • #/dn=… • #/create?parent=… • #/password?dn=… ----------

function applyRoute() {
  let raw = location.hash.slice(1) || '/';
  if (!raw.startsWith('/')) raw = '/' + raw; // совместимость: '#dn=…' → '#/dn=…'
  const qi = raw.indexOf('?');
  const path = qi === -1 ? raw : raw.slice(0, qi);
  const q = new URLSearchParams(qi === -1 ? '' : raw.slice(qi + 1));

  // не авторизован — только логин; запрошенный адрес восстановим после входа
  if (!getCreds()) {
    showLogin();
    if (path !== '/login') {
      pendingHash = location.hash;
      location.replace('#/login');
    }
    return;
  }
  // авторизован — с логина уходим на грид
  if (path === '/login') {
    location.replace('#/');
    showMain();
    return;
  }
  showMain();

  if (path.startsWith('/dn=')) {
    const dn = decodeURIComponent(path.slice(4));
    if (!dn) return;
    if (entry._dn !== dn) {
      entry.dn = dn;
      group.currentDn = dn;
      memberof.currentDn = dn;
    }
    if (!dlgEntry.open) dlgEntry.showModal();
    return;
  }
  if (path === '/create') {
    centry.openCreate(q.get('parent') || me.base_dn);
    if (!dlgCreate.open) dlgCreate.showModal();
    return;
  }
  if (path === '/password') {
    pwTarget = q.get('dn');
    $('pw-dn').textContent = pwTarget || '';
    $('newpw').value = '';
    const st = $('pw-status');
    st.className = 'pw-status';
    st.textContent = '';
    if (!dlgPassword.open) dlgPassword.showModal();
    return;
  }
  // '/' — грид без модалок
  [dlgEntry, dlgCreate, dlgPassword].forEach((d) => { if (d.open) d.close(); });
}

// ✕/Esc закрывают модалку нативно — синхронизируем адрес
[dlgEntry, dlgCreate, dlgPassword].forEach((d) => d.addEventListener('close', () => {
  const h = location.hash;
  if (h.startsWith('#/dn=') || h.startsWith('#/create') || h.startsWith('#/password')) {
    history.replaceState(null, '', '#/'); // без location.replace: он создаёт отложенную навигацию → гонки
  }
}));

// ---------- экраны ----------

function showLogin() {
  login.hidden = false;
  main.hidden = true;
}

function showMain() {
  main.hidden = false;
  login.hidden = true;
  $('who').textContent = me.dn;
  $('who').title = me.dn;
  if (!gridInit) {
    grid.baseDn = me.base_dn;
    gridInit = true;
  }
}

// ---------- вход/выход ----------

login.addEventListener('wc-login', async (e) => {
  setCreds(e.detail);
  try {
    me = await api('/api/whoami');
  } catch (err) {
    setCreds(null);
    login.setError(err.message);
    return;
  }
  login.setError('');
  gridInit = false;
  if (pendingHash) {
    const h = pendingHash;
    pendingHash = null;
    location.hash = h;
  } else {
    location.hash = '#/';
  }
  applyRoute();
});

$('logout').onclick = () => {
  setCreds(null);
  me = null;
  gridInit = false;
  location.replace('#/login');
  location.reload(); // сброс состояния грида
};

// ---------- действия ----------

// левый клик — выделение внутри грида (wc-select грид обрабатывает сам)
grid.addEventListener('wc-edit', (e) => { location.hash = '#/dn=' + encodeURIComponent(e.detail.dn); });

grid.addEventListener('wc-add', (e) => {
  location.hash = '#/create?parent=' + encodeURIComponent(e.detail.parent);
});

grid.addEventListener('wc-password', (e) => {
  location.hash = '#/password?dn=' + encodeURIComponent(e.detail.dn);
});

$('entry-save').onclick = async () => {
  const st = $('entry-status');
  st.className = 'pw-status';
  try {
    const r = await entry.save();
    st.className = 'pw-status ok';
    st.textContent = r.message;
  } catch (ex) {
    st.className = 'pw-status bad';
    st.textContent = '✖ ' + ex.message;
  }
};

$('create').onclick = async () => {
  const st = $('cstatus');
  st.className = 'pw-status';
  try {
    await centry.create();
    st.className = 'pw-status ok';
    st.textContent = '✓ создано';
  } catch (ex) {
    st.className = 'pw-status bad';
    st.textContent = '✖ ' + ex.message;
  }
};

$('pw-save').onclick = async () => {
  const st = $('pw-status');
  try {
    await api(`/api/password?dn=${encodeURIComponent(pwTarget)}`, {
      method: 'PUT',
      body: JSON.stringify({ password: $('newpw').value }),
    });
    st.className = 'pw-status ok';
    st.textContent = '✓ пароль изменён';
    setTimeout(() => dlgPassword.close(), 400);
  } catch (ex) {
    st.className = 'pw-status bad';
    st.textContent = '✖ ' + ex.message;
  }
};

// обновить грид после изменений; при удалении — закрыть диалоги и очистить панели
document.addEventListener('wc-changed', (e) => {
  grid.reload();
  if (dlgCreate.open) dlgCreate.close();
  if (e.detail?.op === 'delete') {
    entry.clear();
    group.currentDn = null;
    memberof.currentDn = null;
    if (dlgEntry.open) dlgEntry.close();
    history.replaceState(null, '', '#/');
  }
});

// ✕ закрывает модалку (Esc работает нативно)
document.querySelectorAll('.dlg-x').forEach((b) => {
  b.onclick = () => b.closest('dialog').close();
});

// ---------- запуск ----------

window.addEventListener('hashchange', applyRoute);

(async () => {
  if (!getCreds()) return applyRoute(); // → #/login
  try {
    me = await api('/api/whoami');
    applyRoute();
  } catch {
    setCreds(null);
    applyRoute();
  }
})();
