# E2E интерфейса (Playwright)

```sh
cd e2e && npm i playwright && npx playwright install chromium
node real-mouse-e2e.js   # грид, +/−, контекстное меню, модалки
node group-e2e.js        # управление участниками групп
```

Нужен запущенный стенд: `docker compose up -d` (LDAP + app на :8080).
