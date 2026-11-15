# LDAP Manager

Управление LDAP-каталогом: REST API на Rust, Swagger UI, фронт на чистом JS
(web-components + shadow DOM) в `public/`. Один бинарь, без npm/бандлеров.

## Быстрый старт

```sh
LDAP_URL=ldap://адрес-вашего-каталога:389 LDAP_BASE_DN=DC=home,DC=arpa docker compose up --build
```

Compose поднимает только веб-менеджер; каталог (OpenLDAP, Samba AD DC и т.п.) — ваш,
указывается через `LDAP_URL` / `LDAP_BASE_DN`. Вход в UI — DN (или UPN для AD) и пароль
любого пользователя каталога: права определяет сам LDAP (pass-through bind).

- UI: http://localhost:8080
- Swagger: http://localhost:8080/swagger-ui

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

## Группы

Панель «Участники» появляется у записей с `objectClass`:

| objectClass | Каталог | Атрибут состава |
|---|---|---|
| `groupOfNames` | любой LDAP | `member` (DN) |
| `groupOfUniqueNames` | любой LDAP | `uniqueMember` |
| `posixGroup` | RFC 2307 (Unix) | `memberUid` |
| `group` | Active Directory (Samba AD) | `member` + бейдж типа |

У AD-групп рядом с заголовком показывается тип из `groupType`:
`security/distribution · global/domain local/universal`.

- **Создание группы**: в общей форме создания записи — пишете `objectClass`, `cn`
  (для AD ещё `groupType`: `-2147483646` = security/global, `2` = distribution/global).
  Схему проверяет сервер: на OpenLDAP класс `group` не определён — LDAP вернёт
  objectClassViolation (400), создать нельзя; на Samba AD — создастся.
- **Смена типа security ↔ distribution**: редактор записи → изменить значение
  `groupType`. Встроенные (builtin) группы AD менять не даст — это нормально.
- **Пресеты**: в форме создания на AD-каталоге (rootDSE `vendorName` ∋ Samba/
  Microsoft) появляются кнопки «+ AD-группа (security)» и «+ AD-группа (рассылка)» —
  подставляют `objectClass` и `groupType`, остаётся вписать имя.
- **Членство**: у записи с заполненным `memberOf` (AD отдаёт сам) в диалоге
  появляется панель «🔗 Состоит в группах» со ссылками на группы. Только чтение.

## Smoke-тест и e2e

Тестовый OpenLDAP вынесен в `docker-compose.dev.yml`, основной compose его не содержит:

```sh
docker compose -f docker-compose.dev.yml up -d ldap
LDAP_URL=ldap://localhost:1389 LDAP_BASE_DN=dc=example,dc=org cargo test -- --ignored

docker compose -f docker-compose.dev.yml up -d --build   # ldap + app на :8080
node e2e/group-e2e.js                                     # playwright e2e
```

e2e против OpenLDAP проверяет и запрет AD-групп: POST с `objectClass=group`
должен вернуть 400 (LDAP 21/65 — класс не определён в схеме). Проверка против
Samba AD — вручную:
`samba-tool group add testgrp`, открыть группу в UI (бейдж security), добавить
участника, поменять `groupType`.
