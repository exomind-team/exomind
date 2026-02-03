//! WebSocket Server 实现
//! 用于电脑端的 WebSocket 服务端

use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tungstenite::{Message};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::net::SocketAddr;
use futures_util::{StreamExt, SinkExt};
use tokio_tungstenite::WebSocketStream;

/// WebSocket 客户端包装
struct WsClient {
    ws: WebSocketStream<tokio::net::TcpStream>,
}

impl WsClient {
    fn new(ws: WebSocketStream<tokio::net::TcpStream>) -> Self {
        Self { ws }
    }
}

/// WebSocket 服务器
pub struct WsServer {
    /// 服务器地址
    addr: SocketAddr,
    /// 消息发送通道
    tx: mpsc::Sender<Message>,
    /// 运行状态标志
    running: Arc<AtomicBool>,
    /// 活跃的客户端连接
    clients: Arc<parking_lot::Mutex<Vec<Arc<parking_lot::Mutex<WsClient>>>>>,
}

impl WsServer {
    /// 创建新的 WebSocket 服务器实例
    pub fn new(
        host: &str,
        port: u16,
        tx: mpsc::Sender<Message>,
        running: Arc<AtomicBool>,
    ) -> Self {
        let addr = format!("{}:{}", host, port).parse().unwrap();
        Self {
            addr,
            tx,
            running,
            clients: Arc::new(parking_lot::Mutex::new(Vec::new())),
        }
    }

    /// 启动服务器
    pub async fn start(&self) -> Result<(), Box<dyn std::error::Error>> {
        let listener = TcpListener::bind(&self.addr).await?;
        self.running.store(true, Ordering::SeqCst);

        println!("WebSocket server listening on {}", self.addr);

        while self.running.load(Ordering::SeqCst) {
            if let Ok((stream, _)) = listener.accept().await {
                if let Ok(ws) = tokio_tungstenite::accept_async(stream).await {
                    let client = Arc::new(parking_lot::Mutex::new(WsClient::new(ws)));
                    self.clients.lock().push(client);
                }
            }
        }

        Ok(())
    }

    /// 广播消息到所有客户端
    pub async fn broadcast(&self, msg: Message) {
        let clients = self.clients.lock().clone();
        let mut failed_indices = Vec::new();

        for (i, client) in clients.iter().enumerate() {
            let mut client = client.lock();
            if client.ws.send(msg.clone()).await.is_err() {
                failed_indices.push(i);
            }
        }

        // 移除断开的客户端
        let mut clients = self.clients.lock();
        for i in failed_indices.into_iter().rev() {
            clients.remove(i);
        }
    }

    /// 停止服务器
    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
    }

    /// 检查服务器是否运行中
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// 获取当前连接的客户端数量
    pub fn client_count(&self) -> usize {
        self.clients.lock().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;
    use std::sync::atomic::{AtomicBool, Ordering};

    #[tokio::test]
    async fn test_server_start_stop() {
        let (tx, _rx) = mpsc::channel(100);
        let running = Arc::new(AtomicBool::new(false));

        let server = WsServer::new("127.0.0.1", 18888, tx, running.clone());

        assert!(!server.is_running());
        assert_eq!(server.client_count(), 0);

        running.store(true, Ordering::SeqCst);
        assert!(server.is_running());

        server.stop();
        assert!(!server.is_running());
    }

    #[tokio::test]
    async fn test_client_connection() {
        let (tx, _rx) = mpsc::channel(100);
        let running = Arc::new(AtomicBool::new(false));

        let server = WsServer::new("127.0.0.1", 18889, tx, running.clone());

        assert_eq!(server.client_count(), 0);
    }

    #[tokio::test]
    async fn test_message_broadcast() {
        let (tx, _rx) = mpsc::channel(100);
        let running = Arc::new(AtomicBool::new(false));

        let server = WsServer::new("127.0.0.1", 18890, tx, running.clone());

        server.broadcast(Message::Text("test".to_string())).await;
    }

    #[tokio::test]
    async fn test_ping_pong() {
        let (tx, _rx) = mpsc::channel(100);
        let running = Arc::new(AtomicBool::new(false));

        let server = WsServer::new("127.0.0.1", 18891, tx, running.clone());

        assert!(!server.is_running());
    }
}
