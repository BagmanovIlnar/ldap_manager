import { api } from './api.js?v=4';

// членство выбранной записи: показывает memberOf — AD возвращает атрибут сам,
// в OpenLDAP его нет → панель скрыта. Только чтение.
class WcMemberof extends HTMLElement {
  constructor() {
    super();
    this._dn = null;
    this._gen = 0; // счётчик load(): устаревшие ответы отбрасываются
    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host { display: block; padding: 16px; background: var(--panel, #fff); border: 1px solid var(--border, #d8dee6); border-radius: 8px; }
        :host([hidden]) { display: none; }
        h3 { margin: 0 0 10px; font-size: 14px; }
        ul { list-style: none; margin: 0; padding: 0; }
        li { padding: 3px 0; word-break: break-all; }
        a { color: var(--accent, #2563eb); text-decoration: none; cursor: pointer; }
        a:hover { text-decoration: underline; }
        .empty { color: var(--muted, #6b7686); margin: 0; }
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
      const groups = e.attrs.memberOf || [];
      if (!groups.length) { body.innerHTML = ''; this.hidden = true; return; }
      this.hidden = false;
      body.innerHTML = '';
      const h = document.createElement('h3');
      h.textContent = '🔗 Состоит в группах (' + groups.length + ')';
      body.append(h);
      const ul = document.createElement('ul');
      for (const g of groups) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.textContent = g;
        a.title = 'открыть группу';
        a.onclick = () => this.dispatchEvent(new CustomEvent('wc-select', { detail: { dn: g }, bubbles: true, composed: true }));
        li.append(a);
        ul.append(li);
      }
      body.append(ul);
    } catch {
      if (gen !== this._gen) return;
      body.innerHTML = '';
      this.hidden = true;
    }
  }
}

customElements.define('wc-memberof', WcMemberof);
