import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('tauri runtime commands issue-205（Tauri Runtime 命令注册）', () => {
  it('registers runtime command module and handlers（注册 runtime 模块与命令）', () => {
    const commandModule = readFileSync('src-tauri/src/commands/mod.rs', 'utf-8');
    const tauriLib = readFileSync('src-tauri/src/lib.rs', 'utf-8');

    expect(commandModule).toContain('pub mod runtime_commands;');
    expect(tauriLib).toContain('runtime_service_start');
    expect(tauriLib).toContain('runtime_service_stop');
    expect(tauriLib).toContain('runtime_service_status');
    expect(tauriLib).toContain('runtime_service_reachable_address');
    expect(tauriLib).toContain('runtime_service_peer_dial_address');
    expect(tauriLib).toContain('signal_publish_fast');
  });

  it('defines runtime service commands in rust source（Rust 源码定义 runtime 命令）', () => {
    const runtimeCommands = readFileSync('src-tauri/src/commands/runtime_commands.rs', 'utf-8');

    expect(runtimeCommands).toContain('#[tauri::command]');
    expect(runtimeCommands).toContain('pub async fn runtime_service_start');
    expect(runtimeCommands).toContain('pub async fn runtime_service_stop');
    expect(runtimeCommands).toContain('pub fn runtime_service_status');
    expect(runtimeCommands).toContain('pub fn runtime_service_reachable_address');
    expect(runtimeCommands).toContain('pub async fn runtime_service_peer_dial_address');
    expect(runtimeCommands).toContain('pub fn signal_publish_fast');
  });

  it('uses runtime handle publish path for fast signals（快速信号发布必须走 RuntimeHandle 发布链路）', () => {
    const runtimeCommands = readFileSync('src-tauri/src/commands/runtime_commands.rs', 'utf-8');

    expect(runtimeCommands).toContain('handle.publish_signal(');
    expect(runtimeCommands).not.toContain('RuntimeHandle::publish_signal_to_pool(');
  });
});
