use std::net::SocketAddr;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let port = exomind_runtime::configured_port_from_env()?;
    let bind_addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(bind_addr).await?;
    let local_addr = listener.local_addr()?;

    println!("exomind-rt listening on http://{local_addr}");

    axum::serve(listener, exomind_runtime::app(local_addr.port())).await?;
    Ok(())
}
