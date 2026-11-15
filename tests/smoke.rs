//! Smoke-тест LDAP-слоя. Нужен живой LDAP (см. docker-compose.yml):
//!
//! ```sh
//! docker compose up -d ldap
//! cargo test --ignored -- --nocapture
//! ```
//!
//! Переменные (значения по умолчанию — от compose-_LDAP):
//! LDAP_TEST_URL, LDAP_TEST_BASE, LDAP_TEST_DN, LDAP_TEST_PASS

use ldap_manager::ldap::with_ldap;
use ldap_manager::models::Entry;
use std::collections::HashSet;

#[tokio::test]
#[ignore = "нужен живой LDAP: docker compose up -d ldap && cargo test --ignored"]
async fn full_crud_cycle() {
    let url = std::env::var("LDAP_TEST_URL").unwrap_or_else(|_| "ldap://localhost:1389".into());
    let base = std::env::var("LDAP_TEST_BASE").unwrap_or_else(|_| "dc=example,dc=org".into());
    let dn = std::env::var("LDAP_TEST_DN").unwrap_or_else(|_| "cn=admin,dc=example,dc=org".into());
    let pass = std::env::var("LDAP_TEST_PASS").unwrap_or_else(|_| "adminpassword".into());

    let ou_dn = format!(
        "ou=smoke-{},{base}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
    );
    let url_c = url.clone();
    let dn_c = dn.clone();
    let pass_c = pass.clone();
    let ou = ou_dn.clone();

    // create
    with_ldap(url_c.clone(), &dn_c, &pass_c, move |c| {
        c.add(
            &ou,
            vec![
                (
                    "objectClass".to_string(),
                    HashSet::from(["top".to_string(), "organizationalUnit".to_string()]),
                ),
                (
                    "ou".to_string(),
                    HashSet::from([ou
                        .split(',')
                        .next()
                        .unwrap()
                        .trim_start_matches("ou=")
                        .to_string()]),
                ),
            ],
        )?
        .success()?;
        Ok(())
    })
    .await
    .expect("add");

    // read (поиск одной записи)
    let ou2 = ou_dn.clone();
    let found: Option<Entry> = with_ldap(url.clone(), &dn, &pass, move |c| {
        let (mut rs, _) = c
            .search(&ou2, ldap3::Scope::Base, "(objectClass=*)", vec!["*"])?
            .success()?;
        Ok(rs.pop().map(|e| {
            let se = ldap3::SearchEntry::construct(e);
            Entry {
                dn: se.dn,
                attrs: se.attrs.into_iter().collect(),
            }
        }))
    })
    .await
    .expect("search");
    assert!(found.is_some(), "запись должна найтись");

    // modify
    let ou3 = ou_dn.clone();
    with_ldap(url.clone(), &dn, &pass, move |c| {
        c.modify(
            &ou3,
            vec![ldap3::Mod::Replace(
                "description".into(),
                HashSet::from(["smoke".to_string()]),
            )],
        )?
        .success()?;
        Ok(())
    })
    .await
    .expect("modify");

    // password (заменяемый userPassword на той же записи)
    let ou4 = ou_dn.clone();
    with_ldap(url.clone(), &dn, &pass, move |c| {
        c.modify(
            &ou4,
            vec![ldap3::Mod::Replace(
                "userPassword".into(),
                HashSet::from(["s3cret".to_string()]),
            )],
        )?
        .success()?;
        Ok(())
    })
    .await
    .expect("password");

    // неверные креды → LDAP 49 → маппится в 401
    let bad = with_ldap(url.clone(), &dn, "wrong-password", |_| Ok(()))
        .await
        .expect_err("должен быть 401");
    assert_eq!(
        bad.status,
        axum::http::StatusCode::UNAUTHORIZED,
        "{:?}",
        bad.status
    );

    // несуществующая запись → LDAP 32 → 404
    let missing = format!("cn=nope-{},{base}", std::process::id());
    let nf = with_ldap(url.clone(), &dn, &pass, move |c| {
        c.search(&missing, ldap3::Scope::Base, "(objectClass=*)", vec!["dn"])?
            .success()?;
        Ok(())
    })
    .await
    .expect_err("должен быть 404");
    assert_eq!(
        nf.status,
        axum::http::StatusCode::NOT_FOUND,
        "{:?}",
        nf.status
    );

    // delete
    let ou5 = ou_dn.clone();
    with_ldap(url, &dn, &pass, move |c| {
        c.delete(&ou5)?.success()?;
        Ok(())
    })
    .await
    .expect("delete");
}
