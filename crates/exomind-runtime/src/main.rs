use std::net::SocketAddr;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let port = exomind_runtime::configured_port_from_env()?;

    // 支持环境变量 EXOMIND_RT_BIND 指定绑定地址，默认 127.0.0.1
    // 例如：EXOMIND_RT_BIND=0.0.0.0 允许局域网访问
    let bind_host = std::env::var("EXOMIND_RT_BIND").unwrap_or_else(|_| "127.0.0.1".to_string());
    let bind_addr: SocketAddr = format!("{bind_host}:{port}").parse()?;

    let listener = tokio::net::TcpListener::bind(bind_addr).await?;
    let local_addr = listener.local_addr()?;

    println!("exomind-rt listening on http://{local_addr}");

    axum::serve(listener, exomind_runtime::app(local_addr.port())).await?;
    Ok(())
}
