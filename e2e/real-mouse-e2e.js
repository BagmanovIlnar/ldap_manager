const { chromium } = require('playwright');
const { execSync } = require('child_process');
const AUTH = 'cn=admin,dc=example,dc=org:adminpassword';
const api = (m, p, b) => execSync(`curl -s -u "${AUTH}" -X ${m} "http://localhost:8080${p}" -H 'Content-Type: application/json'${b ? ` -d '${JSON.stringify(b)}'` : ''}`).toString();
const enc = (s) => encodeURIComponent(s);
const OU = 'ou=gridtest,dc=example,dc=org';
const cleanup = () => ['ou=real,' + OU, 'uid=bob,' + OU, OU].forEach((dn) => api('DELETE', `/api/entry?dn=${enc(dn)}`));
const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await new Promise(r => setTimeout(r, 300)); } return false; };
const step = async (n, desc, fn) => { const ok = await fn(); console.log(`${n}. ${desc}: ${ok ? 'ok' : 'FAIL'}`); if (!ok) process.exit(1); };

(async () => {
  api('DELETE', `/api/entry?dn=${enc('ou=real,dc=example,dc=org')}`);
  cleanup();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());

  await page.goto('http://localhost:8080', { waitUntil: 'networkidle' });
  const login = page.locator('wc-login');
  await login.locator('input[name="dn"]').fill('cn=admin,dc=example,dc=org');
  await login.locator('input[name="password"]').fill('adminpassword');
  await login.locator('button').click();
  await step('1', 'пустой каталог: корневая запись видна как строка грида', () => until(async () =>
    (await page.evaluate(() => {
      const g = document.getElementById('grid').shadowRoot;
      return [...g.querySelectorAll('tr.rowdata')].map(t => t.dataset.dn);
    })).includes('dc=example,dc=org')));

  const rowBox = async (dn) => page.evaluate((dn) => {
    const tr = [...document.getElementById('grid').shadowRoot.querySelectorAll('tr')]
      .find(t => t.dataset.dn === dn);
    if (!tr) return null;
    tr.scrollIntoView({ block: 'center' }); // строка в видимости для реального клика
    const r = tr.getBoundingClientRect();
    return { x: r.x + 100, y: r.y + r.height / 2 };
  }, dn);

  // НАСТОЯЩИЙ правый клик по корневой записи
  await step('2', 'реальный ПКМ по корню → меню открылось', () => (async () => {
    const b = await rowBox('dc=example,dc=org');
    await page.mouse.click(b.x, b.y, { button: 'right' });
    return await until(async () =>
      await page.evaluate(() => document.getElementById('grid').shadowRoot.getElementById('menu').classList.contains('open')));
  })());

  // «Добавить под-запись» на корне
  await step('3', '«Добавить» на корне → форма с DN базы', () => (async () => {
    await page.evaluate(() => document.getElementById('grid').shadowRoot.getElementById('m-add').click());
    return await until(async () =>
      (await page.evaluate(() => document.getElementById('centry').shadowRoot.getElementById('ndn').value)) === ',dc=example,dc=org', 3000);
  })());

  await step('4', 'создание OU через форму → LDAP', () => (async () => {
    await page.evaluate(() => {
      const f = document.getElementById('centry').shadowRoot;
      f.getElementById('ndn').value = 'ou=real' + f.getElementById('ndn').value;
      f.getElementById('oc').value = 'organizationalUnit';
      f.querySelector('.ablock .ak').value = 'ou';
      f.querySelector('.ablock .av').value = 'real';
      document.getElementById('create').click();
    });
    return await until(() => {
      try { return JSON.parse(api('GET', `/api/entry?dn=${enc('ou=real,dc=example,dc=org')}`)).attrs.ou[0] === 'real'; } catch { return false; }
    });
  })());

  // раскрыть корень: база раскрыта по умолчанию → строка ou=real уже должна появиться
  await step('5', 'новая запись видна в гриде (корень раскрыт)', () => until(async () => !!(await rowBox('ou=real,dc=example,dc=org'))));

  // НАСТОЯЩИЙ левый клик — выделение
  await step('6', 'реальный ЛКМ выделяет строку', () => (async () => {
    const b = await rowBox('ou=real,dc=example,dc=org');
    console.log('   [dbg] клик в', JSON.stringify(b));
    await page.mouse.click(b.x, b.y);
    const res = await until(async () =>
      (await page.evaluate(() => document.getElementById('grid').shadowRoot.querySelector('tr.sel')?.dataset.dn)) === 'ou=real,dc=example,dc=org'
      && !(await page.evaluate(() => document.getElementById('dlg-entry').open)));
    if (!res) {
      const d = await page.evaluate(() => ({
        sel: document.getElementById('grid').shadowRoot.querySelector('tr.sel')?.dataset.dn,
        dlg: document.getElementById('dlg-entry').open,
        rows: [...document.getElementById('grid').shadowRoot.querySelectorAll('tr')].map(t => t.dataset.dn),
      }));
      console.log('   [dbg] состояние:', JSON.stringify(d));
    }
    return res;
  })());

  // +/− : скрыть и раскрыть ветку корня (дочерние строки исчезают/появляются)
  await step('7', '+/− скрывает и раскрывает дочерние строки', () => (async () => {
    await page.evaluate(() => {
      const g = document.getElementById('grid').shadowRoot;
      [...g.querySelectorAll('tr')].find(t => t.dataset.dn === 'dc=example,dc=org').querySelector('.caret').click();
    });
    await page.waitForTimeout(300);
    console.log('   [dbg7] rows после collapse:', await page.evaluate(() =>
      [...document.getElementById('grid').shadowRoot.querySelectorAll('tr')].map(t => `${t.dataset.dn}(d${t.dataset.depth})`)));
    const collapsed = await until(async () => !(await rowBox('ou=real,dc=example,dc=org')));
    const plus = await page.evaluate(() => {
      const g = document.getElementById('grid').shadowRoot;
      return [...g.querySelectorAll('tr')].find(t => t.dataset.dn === 'dc=example,dc=org')?.querySelector('.caret')?.textContent;
    });
    console.log('   [dbg7] collapsed:', collapsed, 'plus:', plus);
    await page.evaluate(() => {
      const g = document.getElementById('grid').shadowRoot;
      [...g.querySelectorAll('tr')].find(t => t.dataset.dn === 'dc=example,dc=org').querySelector('.caret').click();
    });
    const expanded = await until(async () => !!(await rowBox('ou=real,dc=example,dc=org')));
    const minus = await page.evaluate(() => {
      const g = document.getElementById('grid').shadowRoot;
      return [...g.querySelectorAll('tr')].find(t => t.dataset.dn === 'dc=example,dc=org')?.querySelector('.caret')?.textContent;
    });
    return collapsed && plus === '+' && expanded && minus === '−';
  })());

  // реальный ПКМ по дочерней записи → Редактировать
  await step('8', 'реальный ПКМ → «Редактировать» → модалка', () => (async () => {
    const b = await rowBox('ou=real,dc=example,dc=org');
    await page.mouse.click(b.x, b.y, { button: 'right' });
    await until(async () => await page.evaluate(() =>
      document.getElementById('grid').shadowRoot.getElementById('menu').classList.contains('open')));
    await page.evaluate(() => document.getElementById('grid').shadowRoot.getElementById('m-edit').click());
    return await until(async () => {
      const s = await page.evaluate(() => ({
        open: document.getElementById('dlg-entry').open,
        h2: document.getElementById('entry').shadowRoot.querySelector('h2')?.textContent,
      }));
      return s.open && s.h2 === 'ou=real,dc=example,dc=org';
    });
  })());

  await page.keyboard.press('Escape');

  // реальный ПКМ → Удалить
  await step('9', 'реальный ПКМ → «Удалить» → запись удалена', () => (async () => {
    const b = await rowBox('ou=real,dc=example,dc=org');
    await page.mouse.click(b.x, b.y, { button: 'right' });
    await until(async () => await page.evaluate(() =>
      document.getElementById('grid').shadowRoot.getElementById('menu').classList.contains('open')));
    await page.evaluate(() => document.getElementById('grid').shadowRoot.getElementById('m-del').click());
    return await until(() => {
      const out = api('GET', `/api/entry?dn=${enc('ou=real,dc=example,dc=org')}`);
      return out.includes('32') || out.includes('не найдена');
    });
  })());

  await step('10', 'создание записи с паролем и атрибутами → LDAP', () => (async () => {
    const b = await rowBox('dc=example,dc=org');
    await page.mouse.click(b.x, b.y, { button: 'right' });
    await until(async () => await page.evaluate(() =>
      document.getElementById('grid').shadowRoot.getElementById('menu').classList.contains('open')));
    await page.evaluate(() => document.getElementById('grid').shadowRoot.getElementById('m-add').click());
    await until(async () => await page.evaluate(() => document.getElementById('dlg-create').open));
    await page.evaluate(() => {
      const f = document.getElementById('centry').shadowRoot;
      f.getElementById('ndn').value = 'uid=bob,dc=example,dc=org';
      f.getElementById('oc').value = 'inetOrgPerson';
      f.querySelector('.ablock .ak').value = 'cn';
      f.querySelector('.ablock .av').value = 'Bob';
      f.getElementById('addAttr').click();
      let rows = [...f.querySelectorAll('.ablock')];
      rows[1].querySelector('.ak').value = 'sn';
      rows[1].querySelector('.av').value = 'One';
      f.getElementById('addAttr').click();
      rows = [...f.querySelectorAll('.ablock')];
      rows[2].querySelector('.ak').value = 'mail';
      rows[2].querySelector('.av').value = 'bob@example.org';
      f.getElementById('pw').value = 'BobPass123';
      document.getElementById('create').click();
    });
    return await until(() => {
      try {
        const e = JSON.parse(api('GET', `/api/entry?dn=${enc('uid=bob,dc=example,dc=org')}`));
        return e.attrs.mail?.[0] === 'bob@example.org' && e.attrs.cn?.[0] === 'Bob';
      } catch { return false; }
    });
  })());

  await step('11', 'bind с паролем, заданным при создании', () => (async () => {
    try {
      execSync(`ldapwhoami -x -H ldap://localhost:1389 -D "uid=bob,dc=example,dc=org" -w BobPass123`);
      return true;
    } catch { return false; }
  })());

  await step('12', 'ПКМ → «Изменить пароль» → окно с полем и «Сохранить»', () => (async () => {
    const B = 'uid=bob,dc=example,dc=org';
    await until(async () => await page.evaluate((dn) => {
      const g = document.getElementById('grid').shadowRoot;
      const tr = [...g.querySelectorAll('tr')].find(t => t.dataset.dn === dn);
      if (!tr) return false;
      tr.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true, clientX: 300, clientY: 200 }));
      if (!g.getElementById('menu').classList.contains('open')) return false;
      g.getElementById('m-pw').click();
      return true;
    }, B));
    const opened = await until(async () => await page.evaluate(() => document.getElementById('dlg-password').open));
    if (!opened) return false;
    await page.evaluate(() => {
      const d = document.getElementById('dlg-password');
      if (!d.querySelector('.dlg-x')) return false;
      d.querySelector('#newpw').value = 'NewPass456';
      d.querySelector('#pw-save').click();
    });
    await until(async () => !(await page.evaluate(() => document.getElementById('dlg-password').open)));
    try {
      execSync(`ldapwhoami -x -H ldap://localhost:1389 -D "uid=bob,dc=example,dc=org" -w NewPass456`);
    } catch { return false; }
    try {
      execSync(`ldapwhoami -x -H ldap://localhost:1389 -D "uid=bob,dc=example,dc=org" -w BobPass123`);
      return false; // старый пароль должен перестать действовать
    } catch { return true; }
  })());

  await step('12b', '✕ закрывает модалку редактирования', () => (async () => {
    await until(async () => await page.evaluate((dn) => {
      const g = document.getElementById('grid').shadowRoot;
      const tr = [...g.querySelectorAll('tr')].find(t => t.dataset.dn === dn);
      if (!tr) return false;
      tr.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true, clientX: 300, clientY: 200 }));
      return g.getElementById('menu').classList.contains('open');
    }, OU));
    await page.evaluate(() => document.getElementById('grid').shadowRoot.getElementById('m-edit').click());
    await page.evaluate(() => document.getElementById('grid').shadowRoot.getElementById('m-edit').click());
    await until(async () => await page.evaluate(() => document.getElementById('dlg-entry').open));
    await page.evaluate(() => {
      [...document.getElementById('dlg-entry').querySelectorAll('.dlg-x')][0].click();
    });
    return await until(async () => !(await page.evaluate(() => document.getElementById('dlg-entry').open)), 3000);
  })());

  await step('13', 'удаление тестовых записей', () => until(() => {
    api('DELETE', `/api/entry?dn=${enc('uid=bob,dc=example,dc=org')}`);
    const check = api('GET', `/api/entry?dn=${enc('uid=bob,dc=example,dc=org')}`);
    return check.includes('32') || check.includes('не найдена');
  }));

  console.log('14. JS-ошибки:', errors.length ? errors : 'нет');
  api('DELETE', '/api/entry?dn=' + enc(OU));
  await browser.close();
  process.exit(0);
})();