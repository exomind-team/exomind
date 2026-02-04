//! 网络命令模块
//! 用于获取本机网络信息

use std::net::{UdpSocket, SocketAddr, IpAddr};
use rand::Rng;

/// 获取用于设备直连的本机 IP（不刷新端口）
/// 使用当前已绑定的端口
#[tauri::command]
pub fn get_local_ip_with_current_port(port: u16) -> Result<String, String> {
    // 使用已有端口创建 UDP socket
    let socket = match UdpSocket::bind(("0.0.0.0", port)) {
        Ok(s) => s,
        Err(_) => {
            // 端口不可用，返回错误
            return Err(format!("端口 {} 不可用", port));
        }
    };

    // 连接到外部地址获取本机 IP
    let targets = ["8.8.8.8:53"];
    for target in &targets {
        if socket.connect(target).is_ok() {
            if let Ok(local_addr) = socket.local_addr() {
                if let IpAddr::V4(v4) = local_addr.ip() {
                    let octets = v4.octets();

                    // 排除 TUN/VPN 地址
                    if octets[0] == 198 && (octets[1] & 0xfe) == 18 {
                        continue;
                    }
                    // 排除回环
                    if octets[0] == 127 {
                        continue;
                    }

                    return Ok(format!("{}:{}", v4, port));
                }
            }
        }
    }

    Err("无法获取本机 IP".to_string())
}

/// 获取用于设备直连的本机 IP（随机端口）
#[tauri::command]
pub fn get_local_ip_with_random_port() -> Result<String, String> {
    const PORT_RANGE: (u16, u16) = (1949, 2026);

    // 尝试找到可用端口
    let mut rng = rand::thread_rng();
    let mut attempts = 0;
    let max_attempts = 50;

    while attempts < max_attempts {
        let port = rng.gen_range(PORT_RANGE.0..=PORT_RANGE.1);

        // 尝试绑定端口
        let addr: SocketAddr = SocketAddr::new(IpAddr::V4(std::net::Ipv4Addr::new(0, 0, 0, 0)), port);
        match UdpSocket::bind(addr) {
            Ok(socket) => {
                // 成功绑定，连接到外部地址
                let targets = ["8.8.8.8:53"];
                for target in &targets {
                    if socket.connect(target).is_ok() {
                        if let Ok(local_addr) = socket.local_addr() {
                            if let IpAddr::V4(v4) = local_addr.ip() {
                                let octets = v4.octets();

                                // 排除 TUN/VPN 地址
                                if octets[0] == 198 && (octets[1] & 0xfe) == 18 {
                                    continue;
                                }
                                // 排除回环
                                if octets[0] == 127 {
                                    continue;
                                }

                                return Ok(format!("{}:{}", v4, port));
                            }
                        }
                    }
                }
            }
            Err(_) => {
                // 端口被占用，继续尝试
            }
        }
        attempts += 1;
    }

    Err("无法找到可用端口".to_string())
}

/// 检查网络连接状态
#[tauri::command]
pub fn check_network_status() -> Result<bool, String> {
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    socket.connect("8.8.8.8:80").map_err(|e| e.to_string())?;
    Ok(true)
}
