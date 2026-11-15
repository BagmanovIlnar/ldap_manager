const { chromium } = require('playwright');
const { execSync } = require('child_process');
const AUTH = 'cn=admin,dc=example,dc=org:adminpassword';
const api = (m, p, b) => execSync(`curl -s -u "${AUTH}" -X ${m} "http://localhost:8080${p}" -H 'Content-Type: application/json'${b ? ` -d '${JSON.stringify(b)}'` : ''}`).toString();
const enc = (s) => encodeURIComponent(s);
const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await new Promise(r => setTimeout(r, 300)); } return false; };
const step = async (n, desc, fn) => { const ok = await fn(); console.log(`${n}. ${desc}: ${ok ? 'ok' : 'FAIL'}`); if (!ok) process.exit(1); };
const OU = 'ou=uitest,dc=example,dc=org';
const GROUP = 'cn=admins,' + OU;
const VASYA = 'uid=vasya,' + OU;
const PETYA = 'uid=petya,' + OU;
const members = () => { try { return JSON.parse(api('GET', `/api/entry?dn=${enc(GROUP)}`)).attrs.member || []; } catch { return []; } };
const expand = async (dn) => { await until(async () => !!(await page.evaluate((dn) => [...document.getElementById('grid').shadowRoot.querySelectorAll('tr')].find(t => t.dataset.dn === dn), dn))); await page.evaluate((dn) => {
  const g = document.getElementById('grid').shadowRoot;
  [...g.querySelectorAll('tr')].find(t => t.dataset.dn === dn)?.querySelector('.caret')?.click();
}, dn); };
const rclickEdit = async (dn) => until(async () => {
  const opened = await page.evaluate((dn) => {
    const g = document.getElementById('grid').shadowRoot;
    const tr = [...g.querySelectorAll('tr')].find(t => t.dataset.dn === dn);
    if (!tr) return false;
    tr.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true, clientX: 300, clientY: 200 }));
    if (!g.getElementById('menu').classList.contains('open')) return false;
    g.getElementById('m-edit').click();
    return true;
  }, dn);
  return opened && await until(async () => await page.evaluate(() => document.getElementById('dlg-entry').open));
});
let page;
(async () => {
  // чистка + данные
  for (const dn of [GROUP, VASYA, PETYA, OU]) api('DELETE', `/api/entry?dn=${enc(dn)}`);
  api('POST', '/api/entry', { dn: OU, attrs: { objectClass: ['top','organizationalUnit'], ou: ['uitest'] } });
  api('POST', '/api/entry', { dn: VASYA, attrs: { objectClass: ['inetOrgPerson'], cn: ['Vasya'], sn: ['V'] } });
  api('POST', '/api/entry', { dn: PETYA, attrs: { objectClass: ['inetOrgPerson'], cn: ['Petya'], sn: ['P'] } });
  api('POST', '/api/entry', { dn: GROUP, attrs: { objectClass: ['groupOfNames'], cn: ['admins'], member: [VASAYA_OR_EMPTY()] } });
  function VASAYA_OR_EMPTY() { return VASYA; }

  const browser = await chromium.launch();
  page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => console.log('  ', m.text()));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('http://localhost:8080', { waitUntil: 'networkidle' });
  const login = page.locator('wc-login');
  await login.locator('input[name="dn"]').fill('cn=admin,dc=example,dc=org');
  await login.locator('input[name="password"]').fill('adminpassword');
  await login.locator('button').click();
  await step('1', 'логин, грид отрисован', () => until(async () =>
    (await page.evaluate(() => document.getElementById('grid').shadowRoot.querySelectorAll('tr.rowdata').length)) > 0));

  await step('2', 'ветка uitest раскрыта, группа видна', () => until(async () => {
    if (!(await page.evaluate((dn) => [...document.getElementById('grid').shadowRoot.querySelectorAll('tr')].some(t => t.dataset.dn === dn), GROUP))) {
      await expand(OU);
    }
    return await page.evaluate((dn) => [...document.getElementById('grid').shadowRoot.querySelectorAll('tr')].some(t => t.dataset.dn === dn), GROUP);
  }));

  await step('3', 'ПКМ → «Редактировать» → модалка, панель группы видна', () => (async () => {
    await rclickEdit(GROUP);
    return await until(async () => {
      const s = await page.evaluate(() => ({
        open: document.getElementById('dlg-entry').open,
        hidden: document.getElementById('group').hidden,
        count: document.getElementById('group').shadowRoot.querySelectorAll('li .dn').length,
      }));
      return s.open && !s.hidden && s.count === 1;
    });
  })());

  await step('4', 'добавление участника через UI → LDAP', () => (async () => {
    await page.evaluate((dn) => {
      const g = document.getElementById('group');
      g.shadowRoot.querySelector('input').value = dn;
      [...g.shadowRoot.querySelectorAll('button')].find(b => b.textContent.includes('добавить')).click();
    }, PETYA);
    return await until(() => members().includes(PETYA));
  })());

  await step('5', 'исключение через ✕ → LDAP', () => (async () => {
    await page.evaluate((dn) => {
      const g = document.getElementById('group');
      [...g.shadowRoot.querySelectorAll('li')]
        .find(li => li.querySelector('.dn').textContent === dn)
        .querySelector('.x').click();
    }, VASYA);
    return await until(() => !members().includes(VASYA));
  })());

  await step('6', 'не-группа → панель скрыта, memberOf-панель скрыта', () => (async () => {
    await page.keyboard.press('Escape'); // закрыть модалку группы
    await rclickEdit(PETYA);
    return await until(async () => await page.evaluate(() =>
      document.getElementById('dlg-entry').open &&
      document.getElementById('group').hidden &&
      document.getElementById('memberof').hidden));
    if (!ok6) {
      console.log('   [dbg6]', await page.evaluate(() => JSON.stringify({
        dlgOpen: document.getElementById('dlg-entry').open,
        hidden: document.getElementById('group').hidden,
        dn: document.getElementById('group')._dn,
        body: (document.getElementById('group').shadowRoot.getElementById('body')?.innerHTML || '').slice(0, 120),
        hash: location.hash,
      })));
    }
    return ok6;
  })());

  await step('7', 'AD-группа (objectClass=group) против OpenLDAP → отказ сервера (21/65)', () => {
    const r = api('POST', '/api/entry', { dn: 'cn=adgrp,' + OU, attrs: { objectClass: ['group'], cn: ['adgrp'] } });
    api('DELETE', `/api/entry?dn=${enc('cn=adgrp,' + OU)}`);
    return /LDAP (21|65):/.test(r); // 21 = invalidAttributeSyntax, 65 = objectClassViolation
  });

  await step('8', 'форма создания на OpenLDAP — пресетов AD нет', () => until(async () => {
    await page.evaluate(() => { location.hash = '#/create'; });
    if (!(await until(async () => await page.evaluate(() => document.getElementById('dlg-create').open)))) return false;
    return await page.evaluate(() =>
      ![...document.getElementById('centry').shadowRoot.querySelectorAll('button')]
        .some((b) => b.textContent.includes('AD-группа')));
  }));

  console.log('9. JS-ошибки:', errors.length ? errors : 'нет');
  for (const dn of [GROUP, VASYA, PETYA, OU]) api('DELETE', `/api/entry?dn=${enc(dn)}`);
  await browser.close();
  process.exit(0);
})();
