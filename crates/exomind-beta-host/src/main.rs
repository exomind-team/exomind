use exomind_beta_host::{BetaHost, serve_with_frontend_origins};
use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::PathBuf,
    sync::Arc,
};

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("exomind-beta: {error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut arguments = std::env::args().skip(1);
    let mut root: Option<PathBuf> = None;
    let mut port = 0u16;
    let mut frontend_origins = Vec::new();
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--data-dir" => {
                root = Some(
                    arguments
                        .next()
                        .ok_or("--data-dir requires an absolute path")?
                        .into(),
                )
            }
            "--port" => {
                port = arguments
                    .next()
                    .ok_or("--port requires a number")?
                    .parse()?
            }
            "--frontend-origin" => frontend_origins.push(
                arguments
                    .next()
                    .ok_or("--frontend-origin requires an exact loopback HTTP origin")?,
            ),
            "--help" | "-h" => {
                println!(
                    "exomind-beta --data-dir <absolute independent root> [--port <port or 0>] [--frontend-origin <exact loopback HTTP origin>]..."
                );
                return Ok(());
            }
            _ => return Err("unknown argument".into()),
        }
    }
    let root = root.ok_or("--data-dir is required; no legacy/default directory is selected")?;
    let host = Arc::new(tokio::task::spawn_blocking(move || BetaHost::open(&root)).await??);
    let server = serve_with_frontend_origins(
        host,
        SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port),
        frontend_origins,
    )
    .await?;
    println!(
        "Beta listener ready on {}. Credentials remain in the private connection descriptor.",
        server.addr()
    );
    tokio::signal::ctrl_c().await?;
    server.stop().await?;
    Ok(())
}
