class WcLogin extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host { display: grid; place-items: center; min-height: 100vh; }
        :host([hidden]) { display: none; } /* display:grid иначе перебивает hidden */
        form {
          background: var(--panel, #fff); border: 1px solid var(--border, #d8dee6);
          border-radius: 10px; padding: 28px 32px; width: 360px;
          display: grid; gap: 14px;
        }
        h2 { margin: 0 0 4px; font-size: 18px; }
        label { display: grid; gap: 4px; color: var(--muted, #6b7686); font-size: 13px; }
        input {
          padding: 8px 10px; border: 1px solid var(--border, #d8dee6);
          border-radius: 6px; font: inherit; color: inherit; background: var(--bg, #f4f6f8);
        }
        button {
          padding: 9px; border: 0; border-radius: 6px; cursor: pointer;
          background: var(--accent, #2563eb); color: #fff; font: inherit; font-weight: 600;
        }
        button:hover { filter: brightness(1.1); }
        .err { color: var(--danger, #c0392b); margin: 0; min-height: 1em; font-size: 13px; }
      </style>
      <form>
        <h2>Вход в LDAP</h2>
        <label>DN<input name="dn" required placeholder="cn=admin,dc=example,dc=org" autocomplete="username"></label>
        <label>Пароль<input name="password" type="password" required autocomplete="current-password"></label>
        <button>Войти</button>
        <p class="err"></p>
      </form>`;
  }

  connectedCallback() {
    const form = this.shadowRoot.querySelector('form');
    form.onsubmit = (e) => {
      e.preventDefault();
      const d = new FormData(form);
      this.setError('');
      this.dispatchEvent(new CustomEvent('wc-login', {
        detail: { dn: d.get('dn').trim(), password: d.get('password') },
        bubbles: true, composed: true,
      }));
    };
  }

  setError(msg) {
    const el = this.shadowRoot.querySelector('.err');
    el.textContent = msg;
  }
}

customElements.define('wc-login', WcLogin);
