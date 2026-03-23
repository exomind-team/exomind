import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('runtime embedded startup m1（Runtime 内嵌启动约束）', () => {
  it('starts runtime in tauri setup hook（在 setup 钩子自动启动运行时）', () => {
    const tauriLib = readFileSync('src-tauri/src/lib.rs', 'utf-8');
    expect(tauriLib).toContain('.setup(');
    expect(tauriLib).toMatch(/runtime.*start/i);
    expect(tauriLib).toContain('fn resolve_embedded_runtime_port() -> u16');
    expect(tauriLib).toContain('unwrap_or(9124)');
    expect(tauriLib).toContain('ensure_runtime_started(runtime_state, None, Some(runtime_port))');
  });

  it('runtime commands no longer spawn bun server script（不再通过 bun 脚本拉起 runtime）', () => {
    const runtimeCommands = readFileSync('src-tauri/src/commands/runtime_commands.rs', 'utf-8');
    expect(runtimeCommands).not.toContain('agent-runtime-server.js');
    expect(runtimeCommands).not.toContain('Command::new("bun")');
    expect(runtimeCommands).toContain('start_with_options');
  });
});
