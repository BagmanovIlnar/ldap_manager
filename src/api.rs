use crate::ldap::{to_entry, with_ldap};
use crate::models::*;
use axum::extract::{Query, Request, State};
use axum::http::{
    HeaderMap, HeaderValue, StatusCode, header::AUTHORIZATION, header::CACHE_CONTROL,
};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, put};
use axum::{Json, Router};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use ldap3::{Mod, Scope};
use serde::Serialize;
use std::collections::HashSet;
use std::sync::Arc;
use tower_http::services::ServeDir;
use utoipa::openapi::Components;
use utoipa::openapi::security::{Http, HttpAuthScheme, SecurityScheme};
use utoipa::{Modify, OpenApi};
use utoipa_swagger_ui::SwaggerUi;

#[derive(Clone)]
pub struct Config {
    pub ldap_url: String,
    pub base_dn: String,
    pub bind_addr: String,
    pub public_dir: String,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            ldap_url: std::env::var("LDAP_URL").unwrap_or_else(|_| "ldap://127.0.0.1:389".into()),
            base_dn: std::env::var("LDAP_BASE_DN").expect("env LDAP_BASE_DN обязателен"),
            bind_addr: std::env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".into()),
            public_dir: std::env::var("PUBLIC_DIR").unwrap_or_else(|_| "public".into()),
        }
    }
}

pub struct App {
    pub cfg: Config,
}

// ---------- ошибки ----------

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ApiErrorBody {
    pub error: String,
}

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    body: ApiErrorBody,
}

impl ApiError {
    pub fn new(status: StatusCode, error: impl Into<String>) -> Self {
        Self {
            status,
            body: ApiErrorBody {
                error: error.into(),
            },
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(self.body)).into_response()
    }
}

type ApiResult<T> = Result<T, ApiError>;

// ---------- auth: HTTP Basic → LDAP bind ----------

fn creds(headers: &HeaderMap) -> ApiResult<(String, String)> {
    let h = headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .filter(|v| v.starts_with("Basic "))
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::UNAUTHORIZED,
                "нужен HTTP Basic: Authorization: Basic base64(DN:пароль)",
            )
        })?;
    let raw = B64
        .decode(&h[6..])
        .map_err(|_| ApiError::new(StatusCode::UNAUTHORIZED, "битый base64 в Authorization"))?;
    let s = String::from_utf8(raw)
        .map_err(|_| ApiError::new(StatusCode::UNAUTHORIZED, "Authorization не UTF-8"))?;
    let (dn, pass) = s
        .split_once(':')
        .ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, "формат Basic: DN:пароль"))?;
    Ok((dn.into(), pass.into()))
}

// ---------- OpenAPI ----------

#[derive(OpenApi)]
#[openapi(
    info(title = "LDAP Manager API"),
    paths(
        whoami,
        search,
        get_entry,
        create_entry,
        modify_entry,
        delete_entry,
        change_password
    ),
    components(schemas(
        Entry,
        CreateEntry,
        ModifyOp,
        ModifyEntry,
        PasswordChange,
        WhoAmI,
        ApiErrorBody
    )),
    security(("basic_auth" = [])),
    modifiers(&SecurityAddon)
)]
struct ApiDoc;

/// Swagger UI: кнопка Authorize с HTTP Basic
struct SecurityAddon;

impl Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        let components = openapi.components.get_or_insert_with(Components::default);
        components.add_security_scheme(
            "basic_auth",
            SecurityScheme::Http(Http::new(HttpAuthScheme::Basic)),
        );
    }
}

// статика без агрессивного кэша: браузер всегда перепроверяет по ETag (304),
// иначе после обновления приложения у пользователя остаётся старый JS
async fn no_cache(req: Request, next: Next) -> Response {
    let mut res = next.run(req).await;
    res.headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    res
}

pub fn build_router(cfg: Config) -> Router {
    let state = Arc::new(App { cfg: cfg.clone() });
    Router::new()
        .merge(SwaggerUi::new("/swagger-ui").url("/api/openapi.json", ApiDoc::openapi()))
        .route("/api/health", get(health))
        .route("/api/whoami", get(whoami))
        .route("/api/search", get(search))
        .route(
            "/api/entry",
            get(get_entry)
                .post(create_entry)
                .patch(modify_entry)
                .delete(delete_entry),
        )
        .route("/api/password", put(change_password))
        .with_state(state)
        .fallback_service(ServeDir::new(&cfg.public_dir))
        .layer(middleware::from_fn(no_cache))
}

// ---------- хендлеры ----------

async fn health() -> &'static str {
    "ok"
}

#[utoipa::path(
    get,
    path = "/api/whoami",
    security(("basic_auth" = [])),
    responses((status = 200, body = WhoAmI), (status = 401, body = ApiErrorBody))
)]
async fn whoami(State(app): State<Arc<App>>, headers: HeaderMap) -> ApiResult<Json<WhoAmI>> {
    let (dn, pass) = creds(&headers)?;
    with_ldap(app.cfg.ldap_url.clone(), &dn, &pass, |_| Ok(())).await?;
    Ok(Json(WhoAmI {
        dn,
        base_dn: app.cfg.base_dn.clone(),
    }))
}

#[utoipa::path(
    get,
    path = "/api/search",
    params(SearchQuery),
    security(("basic_auth" = [])),
    responses(
        (status = 200, body = [Entry]),
        (status = 400, body = ApiErrorBody),
        (status = 401, body = ApiErrorBody),
        (status = 502, body = ApiErrorBody)
    )
)]
async fn search(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(q): Query<SearchQuery>,
) -> ApiResult<Json<Vec<Entry>>> {
    let (dn, pass) = creds(&headers)?;
    let base = q.base.unwrap_or_else(|| app.cfg.base_dn.clone());
    let filter = q.filter.unwrap_or_else(|| "(objectClass=*)".into());
    if !filter.starts_with('(') || !filter.ends_with(')') {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "filter должен быть LDAP-фильтром вида (objectClass=*)",
        ));
    }
    let attrs: Vec<String> = q
        .attrs
        .map(|s| {
            s.split(',')
                .map(|a| a.trim().to_string())
                .filter(|a| !a.is_empty())
                .collect()
        })
        .unwrap_or_else(|| vec!["*".into(), "+".into()]);
    let scope = match q.scope.as_deref() {
        Some("one") => Scope::OneLevel,
        Some("base") => Scope::Base,
        _ => Scope::Subtree,
    };
    let entries = with_ldap(app.cfg.ldap_url.clone(), &dn, &pass, move |conn| {
        let (rs, _) = conn.search(&base, scope, &filter, attrs)?.success()?;
        Ok(rs.into_iter().map(to_entry).collect::<Vec<_>>())
    })
    .await?;
    Ok(Json(entries))
}

#[utoipa::path(
    get,
    path = "/api/entry",
    params(EntryQuery),
    security(("basic_auth" = [])),
    responses(
        (status = 200, body = Entry),
        (status = 401, body = ApiErrorBody),
        (status = 404, body = ApiErrorBody),
        (status = 502, body = ApiErrorBody)
    )
)]
async fn get_entry(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(q): Query<EntryQuery>,
) -> ApiResult<Json<Entry>> {
    let (dn, pass) = creds(&headers)?;
    let target = q.dn;
    let entry = with_ldap(app.cfg.ldap_url.clone(), &dn, &pass, move |conn| {
        let (mut rs, _) = conn
            .search(&target, Scope::Base, "(objectClass=*)", vec!["*", "+"])?
            .success()?;
        Ok(rs.pop().map(to_entry))
    })
    .await?;
    entry
        .map(Json)
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "запись не найдена"))
}

#[utoipa::path(
    post,
    path = "/api/entry",
    request_body(content = CreateEntry),
    security(("basic_auth" = [])),
    responses(
        (status = 201, body = Entry),
        (status = 400, body = ApiErrorBody),
        (status = 401, body = ApiErrorBody),
        (status = 409, body = ApiErrorBody),
        (status = 502, body = ApiErrorBody)
    )
)]
async fn create_entry(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(body): Json<CreateEntry>,
) -> ApiResult<(StatusCode, Json<Entry>)> {
    let (dn, pass) = creds(&headers)?;
    if body.dn.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "dn обязателен"));
    }
    if !body.attrs.contains_key("objectClass") {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "attrs должен содержать objectClass",
        ));
    }
    let entry = Entry {
        dn: body.dn.clone(),
        attrs: body.attrs.clone(),
    };
    let attrs: Vec<(String, HashSet<String>)> = body
        .attrs
        .into_iter()
        .map(|(k, v)| (k, v.into_iter().collect()))
        .collect();
    let new_dn = body.dn;
    with_ldap(app.cfg.ldap_url.clone(), &dn, &pass, move |conn| {
        conn.add(&new_dn, attrs)?.success()?;
        Ok(())
    })
    .await?;
    Ok((StatusCode::CREATED, Json(entry)))
}

#[utoipa::path(
    patch,
    path = "/api/entry",
    request_body(content = ModifyEntry),
    security(("basic_auth" = [])),
    responses(
        (status = 204),
        (status = 400, body = ApiErrorBody),
        (status = 401, body = ApiErrorBody),
        (status = 404, body = ApiErrorBody),
        (status = 502, body = ApiErrorBody)
    )
)]
async fn modify_entry(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(body): Json<ModifyEntry>,
) -> ApiResult<StatusCode> {
    let (dn, pass) = creds(&headers)?;
    if body.dn.is_empty() || body.ops.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "нужны dn и непустой ops",
        ));
    }
    let mut mods = Vec::with_capacity(body.ops.len());
    for op in &body.ops {
        if op.attr.is_empty() {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "в ops есть пустой attr",
            ));
        }
        let vals: HashSet<String> = op.values.iter().cloned().collect();
        match op.op.as_str() {
            "add" if !op.values.is_empty() => mods.push(Mod::Add(op.attr.clone(), vals)),
            "replace" => mods.push(Mod::Replace(op.attr.clone(), vals)),
            "delete" => mods.push(Mod::Delete(op.attr.clone(), vals)),
            _ => {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "op ∈ {add, replace, delete}; add требует непустой values",
                ));
            }
        }
    }
    let target = body.dn;
    with_ldap(app.cfg.ldap_url.clone(), &dn, &pass, move |conn| {
        conn.modify(&target, mods)?.success().map(|_| ())
    })
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    delete,
    path = "/api/entry",
    params(EntryQuery),
    security(("basic_auth" = [])),
    responses(
        (status = 204),
        (status = 401, body = ApiErrorBody),
        (status = 404, body = ApiErrorBody),
        (status = 502, body = ApiErrorBody)
    )
)]
async fn delete_entry(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(q): Query<EntryQuery>,
) -> ApiResult<StatusCode> {
    let (dn, pass) = creds(&headers)?;
    let target = q.dn;
    with_ldap(app.cfg.ldap_url.clone(), &dn, &pass, move |conn| {
        conn.delete(&target)?.success().map(|_| ())
    })
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    put,
    path = "/api/password",
    params(EntryQuery),
    request_body(content = PasswordChange),
    security(("basic_auth" = [])),
    responses(
        (status = 204),
        (status = 400, body = ApiErrorBody),
        (status = 401, body = ApiErrorBody),
        (status = 502, body = ApiErrorBody)
    )
)]
async fn change_password(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(q): Query<EntryQuery>,
    Json(body): Json<PasswordChange>,
) -> ApiResult<StatusCode> {
    let (dn, pass) = creds(&headers)?;
    if body.password.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "password обязателен",
        ));
    }
    let target = q.dn;
    let pw = body.password;
    // ponytail: замена userPassword вместо exop PasswordModify; exop — когда нужен
    // серверный хэш или проверка старого пароля
    with_ldap(app.cfg.ldap_url.clone(), &dn, &pass, move |conn| {
        conn.modify(
            &target,
            vec![Mod::Replace("userPassword".into(), HashSet::from([pw]))],
        )?
        .success()
        .map(|_| ())
    })
    .await?;
    Ok(StatusCode::NO_CONTENT)
}
