import { api } from './api.js';

const childrenUrl = (dn) =>
  `/api/search?base=${encodeURIComponent(dn)}&scope=one&filter=${encodeURIComponent('(objectClass=*)')}&attrs=dn,objectClass`;

// иерархический грид каталога: ленивое раскрытие, ПКМ → контекстное меню
class WcGrid extends HTMLElement {
  constructor() {
    super();
    this._base = null;
    this._expanded = new Set();
    this._sel = null;
    this._menuDn = null;
    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host { display: block; overflow: auto; background: var(--panel, #fff); border: 1px solid var(--border, #d8dee6); border-radius: 8px; }
        table { width: 100%; border-collapse: collapse; }
        th {
          text-align: left; font-size: 12px; color: var(--muted, #6b7686);
          padding: 7px 10px; border-bottom: 1px solid var(--border, #d8dee6);
          position: sticky; top: 0; background: var(--panel, #fff); z-index: 1;
        }
        td { padding: 4px 10px; font: inherit; color: inherit; }
        tr.rowdata { cursor: pointer; }
        tr.rowdata:hover td { background: var(--bg, #f4f6f8); }
        tr.sel td { background: var(--accent-soft, #dfe8ff); }
        .caret { display: inline-block; width: 16px; color: var(--accent, #2563eb); font-weight: 700; user-select: none; cursor: pointer; text-align: center; }
        .rdn { white-space: nowrap; }
        .cls { color: var(--muted, #6b7686); font-size: 12px; white-space: nowrap; }
        #menu {
          position: fixed; z-index: 50; min-width: 200px;
          background: var(--panel, #fff); border: 1px solid var(--border, #d8dee6);
          border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.15); padding: 4px; display: none;
        }
        #menu.open { display: block; }
        #menu button {
          display: block; width: 100%; text-align: left; background: none; border: 0;
          padding: 8px 12px; font: inherit; cursor: pointer; border-radius: 6px; color: inherit;
        }
        #menu button:hover { background: var(--bg, #f4f6f8); }
        #menu button.danger { color: var(--danger, #c0392b); }
        .err { color: var(--danger, #c0392b); padding: 8px; }
      </style>
      <table>
        <thead><tr><th style="width:45%">Запись</th><th>Классы</th></tr></thead>
        <tbody id="rows"></tbody>
      </table>
      <div id="menu">
        <button id="m-add">➕ Добавить под-запись</button>
        <button id="m-edit">✏️ Редактировать</button>
        <button id="m-pw">🔑 Изменить пароль</button>
        <button id="m-del" class="danger">🗑 Удалить</button>
      </div>
      <div id="err" class="err" hidden></div>`;
  }

  set baseDn(v) {
    this._base = v;
    this._expanded = new Set([v]); // корень раскрыт сразу
    this.reload();
  }

  // полная перезагрузка с сохранением раскрытых узлов и выделения
  // корневая запись базы — всегда первая строка (меню доступно даже в пустом каталоге)
  async reload() {
    const err = this.shadowRoot.getElementById('err');
    const rows = this.shadowRoot.getElementById('rows');
    err.hidden = true;
    rows.innerHTML = '';
    try {
      const base = await api('/api/entry?dn=' + encodeURIComponent(this._base));
      rows.append(this._row(base.dn, base.attrs.objectClass || [], 0));
      if (this._expanded.has(this._base)) await this._rowsFor(this._base, 1, rows);
      if (this._sel) {
        [...rows.querySelectorAll('tr')].find((t) => t.dataset.dn === this._sel)
          ?.classList.add('sel');
      }
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  }

  async _rowsFor(dn, depth, container) {
    const list = await api(childrenUrl(dn));
    for (const e of list) {
      const tr = this._row(e.dn, e.attrs.objectClass || [], depth);
      container.append(tr);
      if (this._expanded.has(e.dn)) await this._rowsFor(e.dn, depth + 1, container);
    }
  }

  _row(dn, classes, depth) {
    const tr = document.createElement('tr');
    tr.className = 'rowdata';
    tr.dataset.dn = dn;
    tr.dataset.depth = depth;

    const tdName = document.createElement('td');
    const caret = document.createElement('span');
    caret.className = 'caret';
    caret.textContent = '+';
    caret.style.marginLeft = depth * 16 + 'px';
    const rdn = document.createElement('span');
    rdn.className = 'rdn';
    rdn.textContent = dn.split(',')[0];
    rdn.title = dn;
    tdName.append(caret, ' ', rdn);

    const tdCls = document.createElement('td');
    tdCls.className = 'cls';
    const shown = classes.filter((c) => c.toLowerCase() !== 'top');
    tdCls.textContent = shown.join(', ');
    tdCls.title = classes.join(', ');

    tr.append(tdName, tdCls);

    tr.onclick = () => this._select(dn, tr);
    caret.onclick = (e) => { e.stopPropagation(); this._toggle(dn, tr, depth); };
    return tr;
  }

  _select(dn, tr) {
    this.shadowRoot.querySelector('tr.sel')?.classList.remove('sel');
    this._sel = dn;
    tr.classList.add('sel');
    this.dispatchEvent(new CustomEvent('wc-select', {
      detail: { dn }, bubbles: true, composed: true,
    }));
  }

  async _toggle(dn, tr, depth) {
    if (this._expanded.has(dn)) {
      this._expanded.delete(dn);
      let n = tr.nextElementSibling;
      while (n && +n.dataset.depth > depth) {
        const next = n.nextElementSibling;
        n.remove();
        n = next;
      }
      tr.querySelector('.caret').textContent = '+';
    } else {
      this._expanded.add(dn);
      try {
        const frag = document.createDocumentFragment();
        await this._rowsFor(dn, depth + 1, frag);
        tr.after(frag);
        tr.querySelector('.caret').textContent = '−';
      } catch (ex) {
        this._expanded.delete(dn);
        const err = this.shadowRoot.getElementById('err');
        err.textContent = ex.message;
        err.hidden = false;
      }
    }
  }

  // ---------- контекстное меню ----------

  // ПКМ в любом месте грида: на строке — под-запись/правка/удаление,
  // на пустом пространстве — просто «Добавить» (в корень базы)
  _menu(dn, x, y, rootOnly = false) {
    this._menuDn = dn;
    this._menuRoot = rootOnly;
    const m = this.shadowRoot.getElementById('menu');
    this.shadowRoot.getElementById('m-add').textContent =
      rootOnly ? '➕ Добавить' : '➕ Добавить под-запись';
    this.shadowRoot.getElementById('m-edit').style.display = rootOnly ? 'none' : 'block';
    this.shadowRoot.getElementById('m-pw').style.display = rootOnly ? 'none' : 'block';
    this.shadowRoot.getElementById('m-del').style.display = rootOnly ? 'none' : 'block';
    m.style.left = Math.min(x, window.innerWidth - 215) + 'px';
    m.style.top = Math.min(y, window.innerHeight - 130) + 'px';
    m.classList.add('open');
  }

  _closeMenu() {
    this.shadowRoot.getElementById('menu').classList.remove('open');
  }

  connectedCallback() {
    const $ = (id) => this.shadowRoot.getElementById(id);

    $('m-add').onclick = () => {
      this._closeMenu();
      this.dispatchEvent(new CustomEvent('wc-add', {
        detail: { parent: this._menuRoot ? this._base : this._menuDn }, bubbles: true, composed: true,
      }));
    };

    $('m-edit').onclick = () => {
      this._closeMenu();
      const tr = [...this.shadowRoot.querySelectorAll('tr')].find((t) => t.dataset.dn === this._menuDn);
      if (tr) this._select(this._menuDn, tr);
      this.dispatchEvent(new CustomEvent('wc-edit', {
        detail: { dn: this._menuDn }, bubbles: true, composed: true,
      }));
    };

    $('m-pw').onclick = () => {
      this._closeMenu();
      this.dispatchEvent(new CustomEvent('wc-password', {
        detail: { dn: this._menuDn }, bubbles: true, composed: true,
      }));
    };

    $('m-del').onclick = async () => {
      this._closeMenu();
      const dn = this._menuDn;
      if (!confirm(`Удалить ${dn}?`)) return;
      try {
        await api(`/api/entry?dn=${encodeURIComponent(dn)}`, { method: 'DELETE' });
        this._expanded.delete(dn);
        this.dispatchEvent(new CustomEvent('wc-changed', {
          detail: { dn, op: 'delete' }, bubbles: true, composed: true,
        }));
      } catch (ex) {
        const err = $('err');
        err.textContent = ex.message;
        err.hidden = false;
      }
    };

    document.addEventListener('click', () => this._closeMenu());
    document.addEventListener('contextmenu', (e) => {
      if (!e.composedPath().includes(this)) this._closeMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._closeMenu();
    });

    // ПКМ где угодно в гриде: строка → меню записи, пустое место → «Добавить» в корень
    this.oncontextmenu = (e) => {
      e.preventDefault();
      const tr = e.composedPath().find((n) => n.tagName === 'TR' && n.classList?.contains('rowdata'));
      if (tr) {
        this._select(tr.dataset.dn, tr);
        this._menu(tr.dataset.dn, e.clientX, e.clientY);
      } else {
        this._menu(this._base, e.clientX, e.clientY, true);
      }
    };
  }
}

customElements.define('wc-grid', WcGrid);
