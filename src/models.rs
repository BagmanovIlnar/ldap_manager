use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use utoipa::{IntoParams, ToSchema};

/// Запись каталога
#[derive(Debug, Serialize, ToSchema)]
pub struct Entry {
    pub dn: String,
    /// атрибут → значения
    pub attrs: BTreeMap<String, Vec<String>>,
}

/// Создание записи
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateEntry {
    pub dn: String,
    /// атрибут → значения; должен содержать objectClass
    pub attrs: BTreeMap<String, Vec<String>>,
}

/// Одна модификация атрибута
#[derive(Debug, Deserialize, ToSchema)]
pub struct ModifyOp {
    /// add | replace | delete (delete без values удаляет атрибут целиком)
    pub op: String,
    pub attr: String,
    #[serde(default)]
    pub values: Vec<String>,
}

/// Модификация записи
#[derive(Debug, Deserialize, ToSchema)]
pub struct ModifyEntry {
    pub dn: String,
    pub ops: Vec<ModifyOp>,
}

/// Смена пароля
#[derive(Debug, Deserialize, ToSchema)]
pub struct PasswordChange {
    pub password: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct WhoAmI {
    pub dn: String,
    pub base_dn: String,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct SearchQuery {
    /// DN базы поиска, по умолчанию LDAP_BASE_DN
    pub base: Option<String>,
    /// sub | one | base, по умолчанию sub
    pub scope: Option<String>,
    /// LDAP-фильтр, по умолчанию (objectClass=*)
    pub filter: Option<String>,
    /// атрибуты через запятую, по умолчанию *,+
    pub attrs: Option<String>,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct EntryQuery {
    /// DN записи
    pub dn: String,
}
