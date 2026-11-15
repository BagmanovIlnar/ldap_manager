use crate::api::ApiError;
use crate::models::Entry;
use axum::http::StatusCode;
use ldap3::{LdapConn, LdapError, ResultEntry, SearchEntry};

/// Выполняет замыкание на синхронном LDAP-соединении в отдельном потоке,
/// с bind по переданным кредам (pass-through аутентификация).
pub async fn with_ldap<T, F>(url: String, dn: &str, pass: &str, f: F) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce(&mut LdapConn) -> Result<T, LdapError> + Send + 'static,
{
    let (dn, pass) = (dn.to_string(), pass.to_string());
    tokio::task::spawn_blocking(move || {
        // ponytail: новое соединение на каждый запрос; пул — когда упрёмся в latency
        let mut conn = LdapConn::new(&url).map_err(map_ldap_err)?;
        conn.simple_bind(&dn, &pass)
            .map_err(map_ldap_err)?
            .success()
            .map_err(map_ldap_err)?;
        let out = f(&mut conn).map_err(map_ldap_err)?;
        let _ = conn.unbind();
        Ok::<T, ApiError>(out)
    })
    .await
    .map_err(|e| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("join error: {e}"),
        )
    })?
}

/// Коды ошибок LDAP → HTTP
pub(crate) fn map_ldap_err(e: LdapError) -> ApiError {
    match e {
        LdapError::LdapResult { result } => {
            let status = match result.rc {
                32 => StatusCode::NOT_FOUND,    // noSuchObject
                49 => StatusCode::UNAUTHORIZED, // invalidCredentials
                68 => StatusCode::CONFLICT,     // entryAlreadyExists
                // схема/синтаксис: invalidAttributeSyntax, attributeOrValueExists,
                // invalidDNSyntax, namingViolation, objectClassViolation, notAllowedOn*, other
                19 | 20 | 21 | 34 | 64 | 65 | 66 | 69 | 71 | 80 => StatusCode::BAD_REQUEST,
                _ => StatusCode::BAD_GATEWAY,
            };
            ApiError::new(status, format!("LDAP {}: {}", result.rc, result.text))
        }
        e => ApiError::new(StatusCode::BAD_GATEWAY, e.to_string()),
    }
}

pub(crate) fn to_entry(re: ResultEntry) -> Entry {
    let se = SearchEntry::construct(re);
    // HashMap → BTreeMap: стабильный (алфавитный) порядок атрибутов в JSON
    Entry {
        dn: se.dn,
        attrs: se.attrs.into_iter().collect(),
    }
}
