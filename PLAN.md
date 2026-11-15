# План: LDAP Manager (Rust + чистый JS фронт)

Управление LDAP-каталогом: REST API на Rust, Swagger, фронт на web-components в `public/`, запуск в Docker.

## Стек (минимум зависимостей)

| Слой | Выбор | Почему |
|---|---|---|
| Язык | Rust 1.100.0 (`rust:1.100` в Docker) | по требованию |
| HTTP | `axum` | де-факто стандарт, минимум кода |
| LDAP | `ldap3` | единственный живой LDAP-клиент |
| TLS к LDAP | `ldap3` + `rustls` feature | без OpenSSL → простой Docker-билд |
| OpenAPI/Swagger | `utoipa` + `utoipa-swagger-ui` | Swagger-UI генерируется из аннотаций кода, самодостаточно (без CDN) |
| Статика | `tower-http` ServeDir | раздаёт `public/`, без nginx |
| Сериализация | `serde` / `serde_json` | обязательная пара |
| Конфиг | `envy` или ручной `std::env` | env-переменные, без конфиг-фреймворков |

Аутентификация: **pass-through bind** — фронт шлёт HTTP Basic (DN + пароль), бэкенд этими же кредами биндится к LDAP. Без хранения паролей, без сессий, без JWT. HTTPS терминирует reverse-proxy снаружи (вне скоупа).

## Структура проекта

```
ldap_manager/
├── Cargo.toml
├── Dockerfile
├── .env.example
├── PLAN.md
├── src/
│   ├── main.rs        # env-конфиг, роутер, запуск
│   ├── ldap.rs        # обёртка над ldap3: bind, search, add, modify, delete, passwd
│   ├── api.rs         # handlers + utoipa-аннотации
│   └── models.rs      # utoipa-модели (Entry, Attr, Op)
├── public/            # фронт, отдаётся as-is, без сборки
│   ├── index.html
│   ├── js/
│   │   ├── app.js         # роутер, api-клиент (fetch + Basic auth)
│   │   ├── wc-login.js    # <wc-login>     — форма DN/пароля
│   │   ├── wc-tree.js     # <wc-tree>      — дерево каталога (поиск по base)
│   │   ├── wc-entry.js    # <wc-entry>     — карточка записи: просмотр/редактирование атрибутов
│   │   └── wc-entry-form.js # <wc-entry-form> — создание/удаление, смена пароля
│   └── css/base.css      # только общие переменные; стили компонентов — в shadow DOM
└── tests/api.rs        # интеграционный smoke-тест (по флагу/фиче)
```

Каждый web-component: `customElements.define`, `attachShadow({mode:'open'})`, только native API (CustomEvent, fetch, template literals). Никаких библиотек, бандлеров, npm.

## API (черновик контракта)

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/whoami` | проверка bind, DN текущего пользователя |
| GET | `/api/search?base=&scope=&filter=` | поиск записей (sub/one/base) |
| GET | `/api/entry?dn=` | одна запись со всеми атрибутами |
| POST | `/api/entry` | создать `{dn, attrs: {k:[v]}}` |
| PATCH | `/api/entry` | изменить `{dn, ops:[{op:add\|replace\|delete, attr, values}]}` |
| DELETE | `/api/entry?dn=` | удалить поддерево/запись |
| PUT | `/api/password?dn=` | `userPassword` (modify extension или replace) |
| GET | `/swagger-ui` | Swagger UI (utoipa-swagger-ui embed) |
| GET | `/api/openapi.json` | OpenAPI spec |
| / | `public/*` | статика фронта |

Ошибки — единый `{error: "..."}` + HTTP-код; ошибки LDAP мапятся: `NoSuchObject→404`, `EntryAlreadyExists→409`, `InvalidCredentials→401`, прочее→502.

## Конфиг (env)

```
LDAP_URL=ldap://ldap:389        # или ldaps://
LDAP_BASE_DN=dc=example,dc=org
BIND_ADDR=0.0.0.0:8080
```

## Фазы (каждая фаза = рабочий билд)

### 1. Скелет сервиса
`cargo init`, axum + envy, `/api/health`, конфиг из env. Проверка: `curl /api/health` → 200.

### 2. LDAP-слой
`src/ldap.rs`: подключение, bind (из Basic-заголовка запроса), search/add/modify/delete/passwd через `ldap3::LdapConn` (соединение на запрос — без пула, `ponytail:` пул если упрёмся в latency). Проверка: unit-тест на тестовом LDAP в docker-compose (osixia/openldap).

### 3. REST API + Swagger
Handlers в `src/api.rs`, модели с `#[derive(ToSchema)]`, `#[utoipa::path]` на каждый handler, `ApiDoc` в main. Проверка: `/swagger-ui` открывается, все 7 эндпоинтов из него работают через «Try it out».

### 4. Фронт в `public/`
`index.html` + 5 web-components, shadow DOM, роутинг по hash. Поток: login → дерево (wc-tree) → клик по DN → wc-entry → правка атрибутов/пароля, создание и удаление записей. Проверка: полный CRUD руками из браузера + Swagger для сравнения.

### 5. Docker
Multi-stage, release:

```dockerfile
FROM rust:1.100 AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=build /app/target/release/ldap_manager /usr/local/bin/
COPY public /srv/public
ENV PUBLIC_DIR=/srv/public
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/ldap_manager"]
```

(Если Cargo.lock меняется чаще кода — добавить `cargo-chef` для кэша слоёв; пока не нужно.)

### 6. Smoke-тест + README
`tests/api.rs` — поднимается против тестового LDAP (guard `#[ignore]` + `--ignored` в CI или локально), README с `docker run` и env-таблицей.

## Порядок и объём

Фазы 1–3 — бэкенд (~3 файла Rust), фаза 4 — фронт (~5 файлов JS), фазы 5–6 — обвязка. Ориентир: каждая фаза 1 коммит, репо всегда в рабочем состоянии.

## Отложено (YAGNI, добавлять по потребности)

- Пул LDAP-соединений и keep-alive
- Редактор LDAP-схемы и ACL
- Сессии/токены/refresh, RBAC в UI
- i18n, тёмная тема, фреймворк
- Пагинация больших каталогов (ldap3 paged search — когда появится каталог >10k записей)
