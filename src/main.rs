use ldap_manager::api::{Config, build_router};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cfg = Config::from_env();
    let addr = cfg.bind_addr.clone();
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    println!(
        "ldap_manager: http://{addr} | LDAP: {} | base: {} | static: {} | swagger: http://{addr}/swagger-ui",
        cfg.ldap_url, cfg.base_dn, cfg.public_dir
    );
    axum::serve(listener, build_router(cfg)).await?;
    Ok(())
}
