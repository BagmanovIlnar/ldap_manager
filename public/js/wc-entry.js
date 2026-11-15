import { api } from './api.js?v=4';

// единый редактор записи: режим create (POST {dn, attrs}) и edit (PATCH-diff)
// один и тот же редактор атрибутов: блоки [имя │ значения…][+ ещё значение снизу]
class WcEntry extends HTMLElement {
  constructor() {
    super();
    this._mode = null; // 'create' | 'edit' | null
    this._dn = null;
    this._orig = {};
    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host { display: block; padding: 16px; }
        h2 { margin: 0 0 12px; font-size: 15px; word-break: break-all; }
        label { display: grid; gap: 4px; margin-bottom: 10px; color: var(--muted, #6b7686); font-size: 13px; }
        input {
          font: inherit; color: inherit; padding: 7px 9px;
          border: 1px solid var(--border, #d8dee6); border-radius: 6px; background: var(--bg, #f4f6f8);
        }
        .ablock { padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px dashed var(--border, #d8dee6); }
        .arow { display: flex; gap: 10px; align-items: flex-start; }
        .ak { width: 170px; flex: none; }
        .avals { flex: 1; display: grid; gap: 4px; padding-left: 10px; border-left: 2px solid var(--border, #d8dee6); }
        .aval { display: flex; gap: 4px; align-items: center; }
        .aval input { flex: 1; min-width: 0; width: 100%; }
        .mini {
          background: none; border: 0; cursor: pointer; color: var(--accent, #2563eb);
          font: inherit; font-size: 12px; padding: 4px 0; text-align: left; justify-self: start;
        }
        .mini:hover { text-decoration: underline; }
        .x { background: none; border: 0; cursor: pointer; color: var(--danger, #c0392b); font: inherit; padding: 2px 6px; }
        .bar { display: flex; gap: 10px; margin-top: 12px; align-items: center; }
        button { font: inherit; cursor: pointer; border: 1px solid var(--border, #d8dee6); border-radius: 6px; padding: 6px 12px; background: var(--panel, #fff); color: inherit; }
        button.primary { background: var(--accent, #2563eb); border-color: var(--accent, #2563eb); color: #fff; font-weight: 600; }
        .status { color: var(--muted, #6b7686); }
        .status.ok { color: var(--ok, #1e8e3e); }
        .status.bad { color: var(--danger, #c0392b); }
        .hint, .err { color: var(--muted, #6b7686); }
        .err { color: var(--danger, #c0392b); }
        .sect { font-size: 12px; color: var(--muted, #6b7686); margin: 12px 0 6px; }
      </style>
      <div id="body"><p class="hint">Запись не выбрана</p></div>`;
  }

  // ---------- режимы ----------

  // редактирование существующей записи
  set dn(v) {
    this._mode = 'edit';
    this._dn = v;
    this.load();
  }

  clear() {
    this._mode = null;
    this._dn = null;
    this.shadowRoot.getElementById('body').innerHTML = '<p class="hint">Запись не выбрана</p>';
  }

  // создание: DN с запятой — дописать RDN слева
  openCreate(parentDn) {
    this._mode = 'create';
    this._dn = null;
    this._orig = {};
    this._renderCreate(parentDn);
  }

  // ---------- загрузка/рендер ----------

  async load() {
    const body = this.shadowRoot.getElementById('body');
    if (this._mode !== 'edit' || !this._dn) return this.clear();
    body.innerHTML = '<p class="hint">Загрузка…</p>';
    try {
      const e = await api('/api/entry?dn=' + encodeURIComponent(this._dn));
      this._orig = e.attrs;
      this._renderEdit(e);
    } catch (ex) {
      body.innerHTML = `<p class="err">⚠ ${ex.message}</p>`;
    }
  }

  _renderEdit(e) {
    const body = this.shadowRoot.getElementById('body');
    body.innerHTML = '';
    const h = document.createElement('h2');
    h.textContent = e.dn;
    body.append(h);

    const blocks = document.createElement('div');
    blocks.className = 'ablocks';
    for (const [k, vals] of Object.entries(e.attrs)) blocks.append(this._ablock(k, [...vals]));
    body.append(blocks);

    const addbar = document.createElement('div');
    addbar.className = 'bar';
    const add = document.createElement('button');
    add.textContent = '+ атрибут';
    add.onclick = () => blocks.append(this._ablock('', ['']));
    addbar.append(add);
    body.append(addbar);

    const bar = document.createElement('div');
    bar.className = 'bar';
    const save = document.createElement('button');
    save.className = 'primary';
    save.textContent = '💾 Сохранить';
    const status = document.createElement('span');
    status.className = 'status';
    save.onclick = () => this._saveEdit(status);
    bar.append(save, status);
    body.append(bar);
  }

  _renderCreate(parentDn) {
    const body = this.shadowRoot.getElementById('body');
    body.innerHTML = `
      <label>DN*<input id="ndn" placeholder="uid=vasya,ou=people,dc=example,dc=org"></label>
      <label>objectClass* (через запятую)<input id="oc" placeholder="inetOrgPerson, organizationalPerson, person"></label>
      <div class="sect">АТРИБУТЫ</div>
      <div class="ablocks" id="attrRows"></div>
      <div class="bar"><button id="addAttr">+ атрибут</button></div>
      <label>Пароль (userPassword, опционально)<input id="pw" type="password" autocomplete="new-password"></label>
      <div class="bar"><button id="create" class="primary">Создать</button><span id="cstatus" class="status"></span></div>`;
    const $ = (id) => this.shadowRoot.getElementById(id);
    this.shadowRoot.querySelector('#attrRows').append(this._ablock('', ['']));
    $('addAttr').onclick = () => this.shadowRoot.getElementById('attrRows').append(this._ablock('', ['']));
    $('ndn').value = parentDn ? ',' + parentDn : '';
    $('ndn').focus();
    $('ndn').setSelectionRange(0, 0);
    $('create').onclick = () => this._create();
  }

  // ---------- редактор атрибутов ----------

  _ablock(k = '', vals = ['']) {
    const block = document.createElement('div');
    block.className = 'ablock';
    const row = document.createElement('div');
    row.className = 'arow';
    const ak = document.createElement('input');
    ak.className = 'ak';
    ak.placeholder = 'атрибут';
    ak.value = k;
    const avals = document.createElement('div');
    avals.className = 'avals';
    const addVal = (v = '') => {
      const aval = document.createElement('div');
      aval.className = 'aval';
      const inp = document.createElement('input');
      inp.className = 'av';
      inp.placeholder = 'значение';
      inp.value = v;
      const vx = document.createElement('button');
      vx.className = 'x';
      vx.textContent = '✕';
      vx.title = 'убрать значение';
      vx.onclick = () => {
        if (avals.querySelectorAll('.aval').length > 1) aval.remove();
        else inp.value = '';
      };
      aval.append(inp, vx);
      avals.insertBefore(aval, avals.querySelector('.mini')); // новое значение сверху
    };
    for (const v of vals) addVal(v);
    const mini = document.createElement('button');
    mini.className = 'mini';
    mini.textContent = '+ ещё значение';
    mini.onclick = () => addVal('');
    avals.append(mini);
    const x = document.createElement('button');
    x.className = 'x';
    x.textContent = '✕';
    x.title = 'убрать атрибут';
    x.onclick = () => block.remove();
    row.append(ak, avals, x);
    block.append(row);
    return block;
  }

  // ---------- сохранение ----------

  // edit: diff против исходных атрибутов → PATCH
  async _saveEdit(status) {
    status.className = 'status';
    const current = new Map();
    for (const b of this.shadowRoot.querySelectorAll('.ablock')) {
      const k = b.querySelector('.ak').value.trim();
      if (!k) continue;
      const vals = [...b.querySelectorAll('.av')].map((i) => i.value.trim()).filter(Boolean);
      if (!current.has(k)) current.set(k, []);
      current.get(k).push(...vals);
    }
    const ops = [];
    for (const [k, vals] of current) {
      const orig = this._orig[k];
      if (!orig) {
        if (vals.length) ops.push({ op: 'add', attr: k, values: vals });
      } else if (JSON.stringify(vals) !== JSON.stringify([...orig])) {
        ops.push({ op: 'replace', attr: k, values: vals }); // replace с [] удаляет атрибут
      }
    }
    for (const k of Object.keys(this._orig)) {
      if (!current.has(k)) ops.push({ op: 'replace', attr: k, values: [] });
    }
    if (!ops.length) {
      status.textContent = 'нет изменений';
      return;
    }
    try {
      await api('/api/entry', { method: 'PATCH', body: JSON.stringify({ dn: this._dn, ops }) });
      status.className = 'status ok';
      status.textContent = '✓ сохранено';
      this.dispatchEvent(new CustomEvent('wc-changed', {
        detail: { dn: this._dn, op: 'save' }, bubbles: true, composed: true,
      }));
      this.load();
    } catch (ex) {
      status.className = 'status bad';
      status.textContent = '✖ ' + ex.message;
    }
  }

  // create: сборка attrs → POST
  async _create() {
    const $ = (id) => this.shadowRoot.getElementById(id);
    const st = $('cstatus');
    st.className = 'status';
    st.textContent = '';
    const dn = $('ndn').value.trim();
    const oc = $('oc').value.split(',').map((s) => s.trim()).filter(Boolean);
    if (!dn || !oc.length) {
      st.className = 'status bad';
      st.textContent = '✖ нужны DN и objectClass';
      return;
    }
    const attrs = { objectClass: oc };
    for (const b of this.shadowRoot.querySelectorAll('.ablock')) {
      const k = b.querySelector('.ak').value.trim();
      const vals = [...b.querySelectorAll('.av')].map((i) => i.value.trim()).filter(Boolean);
      if (!k || !vals.length) continue;
      (attrs[k] ??= []).push(...vals);
    }
    const pw = $('pw').value;
    if (pw) attrs.userPassword = [pw];
    try {
      await api('/api/entry', { method: 'POST', body: JSON.stringify({ dn, attrs }) });
      st.className = 'status ok';
      st.textContent = '✓ создано';
      this.dispatchEvent(new CustomEvent('wc-changed', {
        detail: { dn, op: 'create' }, bubbles: true, composed: true,
      }));
    } catch (ex) {
      st.className = 'status bad';
      st.textContent = '✖ ' + ex.message;
    }
  }
}

customElements.define('wc-entry', WcEntry);
