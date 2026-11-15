// адресация: /login, /dn, /create, /password + реальный вход с #dn
const { chromium } = require('playwright');
const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await new Promise(r => setTimeout(r, 300)); } return false; };
const step = async (n, desc, fn) => { const ok = await fn(); console.log(`${n}. ${desc}: ${ok ? 'ok' : 'FAIL'}`); if (!ok) process.exit(1); };
const login = async (page) => {
  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle' });
  const l = page.locator('wc-login');
  await l.locator('input[name="dn"]').fill('cn=admin,dc=example,dc=org');
  await l.locator('input[name="password"]').fill('adminpassword');
  await l.locator('button').click();
  await until(async () => await page.evaluate(() => !document.getElementById('app').hidden));
};
const rclickMenu = async (page, dn, item) => until(async () => await page.evaluate(([dn, item]) => {
  const g = document.getElementById('grid').shadowRoot;
  const tr = [...g.querySelectorAll('tr')].find(t => t.dataset.dn === dn);
  if (!tr) return false;
  tr.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true, clientX: 300, clientY: 200 }));
  if (!g.getElementById('menu').classList.contains('open')) return false;
  g.getElementById(item).click();
  return true;
}, [dn, item]));

(async () => {
  const browser = await chromium.launch();

  // 1. неавторизованный на / → редирект на #/login
  let page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle' });
  await step('1', 'неавторизован → адрес #/login, форма видна', () => until(async () => await page.evaluate(() =>
    location.hash === '#/login' && !document.getElementById('login').hidden && document.getElementById('app').hidden)));

  // 2. вход → #/, грид
  await page.locator('wc-login').locator('input[name="dn"]').fill('cn=admin,dc=example,dc=org');
  await page.locator('wc-login').locator('input[name="password"]').fill('adminpassword');
  await page.locator('wc-login').locator('button').click();
  await step('2', 'вход → #/, грид виден', () => until(async () => await page.evaluate(() =>
    location.hash === '#/' && !document.getElementById('app').hidden)));

  // 3. ПКМ → Редактировать → #/dn=..., модалка
  await page.evaluate(() => {
    const g = document.getElementById('grid').shadowRoot;
    [...g.querySelectorAll('tr')].find(t => t.dataset.dn === 'dc=example,dc=org')
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true, clientX: 300, clientY: 150 }));
    g.getElementById('m-edit').click();
  });
  await step('3', 'редактирование → #/dn=… + модалка', () => until(async () => await page.evaluate(() =>
    location.hash.startsWith('#/dn=') && document.getElementById('dlg-entry').open)));

  // 4. F5 на #/dn=… — модалка восстанавливается
  await page.reload({ waitUntil: 'networkidle' });
  await step('4', 'F5 на #/dn=… → модалка восстановлена', () => until(async () => await page.evaluate(() =>
    document.getElementById('dlg-entry').open &&
    document.getElementById('entry').shadowRoot.querySelector('h2')?.textContent === 'dc=example,dc=org')));

  // 5. ✕ → #/, модалка закрыта
  await page.evaluate(() => document.querySelector('#dlg-entry .dlg-x').click());
  await step('5', '✕ → модалка закрыта, адрес #/', () => until(async () => await page.evaluate(() =>
    !document.getElementById('dlg-entry').open && location.hash === '#/')));

  // 6. ПКМ → Изменить пароль → #/password?dn=… + модалка
  await rclickMenu(page, 'dc=example,dc=org', 'm-pw');
  await step('6', 'пароль → #/password?dn=… + модалка с полем', () => until(async () => await page.evaluate(() =>
    location.hash.startsWith('#/password?dn=') && document.getElementById('dlg-password').open &&
    !!document.getElementById('newpw'))));
  await page.keyboard.press('Escape');
  await until(async () => await page.evaluate(() => !document.getElementById('dlg-password').open));

  // 7. ПКМ → Добавить под-запись → #/create?parent=… + модалка
  await rclickMenu(page, 'dc=example,dc=org', 'm-add');
  await step('7', 'создание → #/create?parent=… + модалка с DN родителя', () => until(async () => await page.evaluate(() =>
    location.hash.startsWith('#/create?parent=') && document.getElementById('dlg-create').open &&
    document.getElementById('centry').shadowRoot.getElementById('ndn').value.startsWith(',dc=example,dc=org'))));

  // 8. ✕ → #/
  await page.evaluate(() => document.querySelector('#dlg-create .dlg-x').click());
  await step('8', '✕ создания → адрес #/', () => until(async () => await page.evaluate(() =>
    !document.getElementById('dlg-create').open && location.hash === '#/')));

  // 9. прямой переход на #/password?dn=… без меню
  await page.evaluate(() => { location.hash = '#/password?dn=' + encodeURIComponent('dc=example,dc=org'); });
  await step('9', 'прямой адрес #/password?dn=… открывает окно', () => until(async () => await page.evaluate(() =>
    document.getElementById('dlg-password').open)));

  // 10. F5 на #/login при активной сессии → возвращет на #/
  await page.evaluate(() => { location.hash = '#/login'; });
  await page.waitForTimeout(500);
  await step('10', 'авторизован на #/login → редирект на #/', () => until(async () => await page.evaluate(() =>
    location.hash === '#/' && !document.getElementById('app').hidden)));

  console.log('11. JS-ошибки:', errors.length ? errors : 'нет');
  await page.close();
  await browser.close();
  process.exit(0);
})();
