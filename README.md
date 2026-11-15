# LDAP Manager

Управление LDAP-каталогом: REST API на Rust, Swagger UI, фронт на чистом JS
(web-components + shadow DOM) в `public/`. Один бинарь, без npm/бандлеров.

## Быстрый старт

```sh
docker compose up --build
```

- UI: http://localhost:8080
- Swagger: http://localhost:8080/swagger-ui
- Bind DN: `cn=admin,dc=example,dc=org`, пароль: `adminpassword` (тестовый LDAP из compose)

## Конфиг (env)

| Переменная | По умолчанию | Описание |
|---|---|---|
| `LDAP_URL` | `ldap://127.0.0.1:389` | `ldap://` или `ldaps://` |
| `LDAP_BASE_DN` | — (обязательна) | корневой DN каталога |
| `BIND_ADDR` | `0.0.0.0:8080` | адрес HTTP-сервера |
| `PUBLIC_DIR` | `public` | каталог статики |

## Аутентификация

Pass-through: HTTP Basic (`DN:пароль`) из запроса используется как bind-креды к LDAP.
Ничего не хранится; права ровно те, что даёт LDAP под этим DN. HTTPS — терминировать
снаружи (reverse-proxy).

## API

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/health` | liveness, без auth |
| GET | `/api/whoami` | проверка bind |
| GET | `/api/search?base=&scope=sub\|one\|base&filter=&attrs=` | поиск |
| GET | `/api/entry?dn=` | запись целиком (`*`,`+`) |
| POST | `/api/entry` | создать `{dn, attrs}` |
| PATCH | `/api/entry` | изменить `{dn, ops:[{op, attr, values}]}` |
| DELETE | `/api/entry?dn=` | удалить запись |
| PUT | `/api/password?dn=` | `userPassword` = `{password}` |

Ошибки LDAP маппятся в HTTP: `noSuchObject→404`, `invalidCredentials→401`,
`entryAlreadyExists→409`, нарушения схемы→`400`, прочее→`502`. Тело: `{"error": "..."}`.

## Фронт

`public/` — без сборки и зависимостей: native web-components c shadow DOM
(`wc-login`, `wc-tree`, `wc-entry`, `wc-entry-form`), hash-навигация по DN,
сессия в `sessionStorage`. Раздаётся тем же бинарем (`ServeDir`).

## Smoke-тест

```sh
docker compose up -d ldap
cargo test -- --ignored   # полный CRUD-цикл по LDAP
```

env при необходимости: `LDAP_TEST_URL`, `LDAP_TEST_BASE`, `LDAP_TEST_DN`, `LDAP_TEST_PASS`.

## Ручной запуск без Docker

```sh
LDAP_URL=ldap://localhost:1389 LDAP_BASE_DN=dc=example,dc=org cargo run
```
