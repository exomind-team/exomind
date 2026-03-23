#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut handle = exomind_runtime::start().await?;
    println!("exomind-rt listening on http://{}", handle.local_addr());

    tokio::signal::ctrl_c().await?;
    handle.stop().await?;
    Ok(())
}
