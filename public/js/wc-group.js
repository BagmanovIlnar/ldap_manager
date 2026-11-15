import { api } from './api.js?v=4';

// управление составом группы (groupOfNames/groupOfUniqueNames → member/uniqueMember,
// posixGroup → memberUid, AD `group` → member + тип из groupType).
// Панель показывается, если выбранная запись — группа.
const GROUP_CLASSES = ['groupofnames', 'groupofuniquenames', 'posixgroup', 'group'];

// groupType (AD): битовая маска. 0x80000000 = security, иначе distribution;
// 0x2 = global, 0x4 = domain local, 0x8 = universal
function adGroupType(raw) {
  const t = Number(raw || 0) >>> 0;
  if (!t) return '';
  const kind = t & 0x80000000 ? 'security' : 'distribution';
  const scope = t & 0x8 ? 'universal' : t & 0x4 ? 'domain local' : 'global';
  return kind + ' · ' + scope;
}

class WcGroup extends HTMLElement {
  constructor() {
    super();
    this._dn = null;
    this._gen = 0; // счётчик load(): устаревшие ответы отбрасываются
    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host { display: block; padding: 16px; background: var(--panel, #fff); border: 1px solid var(--border, #d8dee6); border-radius: 8px; }
        :host([hidden]) { display: none; }
        h3 { margin: 0 0 10px; font-size: 14px; }
        ul { list-style: none; margin: 0 0 10px; padding: 0; }
        li { display: flex; gap: 8px; align-items: center; padding: 3px 0; }
        .dn { flex: 1; word-break: break-all; }
        .x { background: none; border: 0; cursor: pointer; color: var(--danger, #c0392b); font: inherit; padding: 2px 6px; }
        input { flex: 1; font: inherit; padding: 7px 9px; border: 1px solid var(--border, #d8dee6); border-radius: 6px; background: var(--bg, #f4f6f8); color: inherit; }
        button {
          font: inherit; cursor: pointer; border: 1px solid var(--border, #d8dee6);
          border-radius: 6px; padding: 6px 12px; background: var(--panel, #fff); color: inherit;
        }
        button.primary { background: var(--accent, #2563eb); border-color: var(--accent, #2563eb); color: #fff; font-weight: 600; }
        .status { font-size: 13px; color: var(--muted, #6b7686); }
        .status.ok { color: var(--ok, #1e8e3e); }
        .status.bad { color: var(--danger, #c0392b); }
        .row { display: flex; gap: 8px; align-items: center; }
        .empty { color: var(--muted, #6b7686); margin: 0 0 10px; }
      </style>
      <div id="body"></div>`;
  }

  set currentDn(v) {
    this._dn = v;
    this.load();
  }

  async load() {
    const gen = ++this._gen;
    const body = this.shadowRoot.getElementById('body');
    if (!this._dn) { body.innerHTML = ''; this.hidden = true; return; }
    try {
      const e = await api('/api/entry?dn=' + encodeURIComponent(this._dn));
      if (gen !== this._gen) return; // пришёл ответ на устаревший запрос
      const classes = (e.attrs.objectClass || []).map((c) => c.toLowerCase());
      const cls = GROUP_CLASSES.find((c) => classes.includes(c));
      if (!cls) { body.innerHTML = ''; this.hidden = true; return; }
      const attr = cls === 'posixGroup' ? 'memberUid' : cls === 'groupOfUniqueNames' ? 'uniqueMember' : 'member';
      this.hidden = false;
      this._render(attr, e.attrs[attr] || [], cls === 'group' ? adGroupType(e.attrs.groupType?.[0]) : '');
    } catch {
      if (gen !== this._gen) return;
      body.innerHTML = '';
      this.hidden = true;
    }
  }

  _render(attr, members, badge) {
    const body = this.shadowRoot.getElementById('body');
    body.innerHTML = '';
    const h = document.createElement('h3');
    h.textContent = '👥 Участники (' + attr + ')' + (badge ? ' — ' + badge : '');
    body.append(h);

    if (!members.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'пусто';
      body.append(p);
    } else {
      const ul = document.createElement('ul');
      for (const m of members) {
        const li = document.createElement('li');
        const span = document.createElement('span');
        span.className = 'dn';
        span.textContent = m;
        const x = document.createElement('button');
        x.className = 'x';
        x.textContent = '✕';
        x.title = 'исключить';
        x.onclick = () => this._modify('delete', attr, [m], null);
        li.append(span, x);
        ul.append(li);
      }
      body.append(ul);
    }

    const row = document.createElement('div');
    row.className = 'row';
    const input = document.createElement('input');
    input.placeholder = attr === 'memberUid' ? 'uid (напр. vasya)' : 'DN участника (напр. uid=vasya,ou=people,…)';
    const add = document.createElement('button');
    add.className = 'primary';
    add.textContent = '+ добавить';
    const status = document.createElement('span');
    status.className = 'status';
    add.onclick = () => {
      const v = input.value.trim();
      if (!v) return;
      this._modify('add', attr, [v], status);
      input.value = '';
    };
    row.append(input, add, status);
    body.append(row);
  }

  async _modify(op, attr, values, status) {
    try {
      await api('/api/entry', { method: 'PATCH', body: JSON.stringify({ dn: this._dn, ops: [{ op, attr, values }] }) });
      if (status) { status.className = 'status ok'; status.textContent = '✓'; }
      this.load();
      this.dispatchEvent(new CustomEvent('wc-changed', { detail: { dn: this._dn }, bubbles: true, composed: true }));
    } catch (ex) {
      if (status) { status.className = 'status bad'; status.textContent = '✖ ' + ex.message; }
      else alert(ex.message);
    }
  }
}

customElements.define('wc-group', WcGroup);
