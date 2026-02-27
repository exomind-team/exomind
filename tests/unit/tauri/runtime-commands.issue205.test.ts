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
  });

  it('defines runtime service commands in rust source（Rust 源码定义 runtime 命令）', () => {
    const runtimeCommands = readFileSync('src-tauri/src/commands/runtime_commands.rs', 'utf-8');

    expect(runtimeCommands).toContain('#[tauri::command]');
    expect(runtimeCommands).toContain('pub fn runtime_service_start');
    expect(runtimeCommands).toContain('pub fn runtime_service_stop');
    expect(runtimeCommands).toContain('pub fn runtime_service_status');
  });
});
