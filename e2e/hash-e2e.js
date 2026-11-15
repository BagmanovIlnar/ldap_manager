// вход с #dn в адресе: битый hash не ломает вход, валидный открывает модалку
const { chromium } = require('playwright');
const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await new Promise(r => setTimeout(r, 300)); } return false; };
const step = async (n, desc, fn) => { const ok = await fn(); console.log(`${n}. ${desc}: ${ok ? 'ok' : 'FAIL'}`); if (!ok) process.exit(1); };

(async () => {
  const browser = await chromium.launch();

  // сценарий A: валидный #dn
  let page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://localhost:8080/#dn=dc%3Dexample%2Cdc%3Dorg', { waitUntil: 'networkidle' });
  const login = page.locator('wc-login');
  await login.locator('input[name="dn"]').fill('cn=admin,dc=example,dc=org');
  await login.locator('input[name="password"]').fill('adminpassword');
  await login.locator('button').click();
  await step('A1', 'вход с #dn в адресе удался', () => until(async () =>
    await page.evaluate(() => !document.getElementById('app').hidden && document.getElementById('login').hidden)));
  await step('A2', 'модалка записи открылась по hash', () => until(async () =>
    await page.evaluate(() => document.getElementById('dlg-entry').open)));
  await page.keyboard.press('Escape');
  await page.close();

  // сценарий B: несуществующий #dn — вход всё равно успешен
  page = await browser.newPage();
  const errorsB = [];
  page.on('pageerror', e => errorsB.push('pageerror: ' + e.message));
  await page.goto('http://localhost:8080/#dn=cn%3Dnonexistent%2Cdc%3Dexample%2Cdc%3Dorg', { waitUntil: 'networkidle' });
  const login2 = page.locator('wc-login');
  await login2.locator('input[name="dn"]').fill('cn=admin,dc=example,dc=org');
  await login2.locator('input[name="password"]').fill('adminpassword');
  await login2.locator('button').click();
  await step('B1', 'битый #dn не ломает вход', () => until(async () =>
    await page.evaluate(() => !document.getElementById('app').hidden)));
  await step('B2', 'карточка показывает ошибку записи, сессия жива', () => until(async () =>
    await page.evaluate(() => document.getElementById('entry').shadowRoot.textContent.includes('LDAP 32'))));
  console.log('B3. JS-ошибки:', errorsB.length ? errorsB : 'нет');

  // сценарий C: логин при пустом hash (обычный вход)
  page = await browser.newPage();
  await page.goto('http://localhost:8080', { waitUntil: 'networkidle' });
  const login3 = page.locator('wc-login');
  await login3.locator('input[name="dn"]').fill('cn=admin,dc=example,dc=org');
  await login3.locator('input[name="password"]').fill('adminpassword');
  await login3.locator('button').click();
  await step('C1', 'обычный вход без hash', () => until(async () =>
    await page.evaluate(() => !document.getElementById('app').hidden)));
  await page.close();

  await browser.close();
  process.exit(0);
})();
