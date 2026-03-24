import { invoke } from '@tauri-apps/api/core';

/**
 * 追加内容到 Markdown 文件
 */
export async function appendToMarkdown(filename: string, content: string): Promise<void> {
  await invoke('append_to_markdown', { filename, content });
}

/**
 * 导出所有消息到 Markdown 文件
 */
export async function exportMessagesToMarkdown(
  filename: string,
  title: string,
  messages: string
): Promise<void> {
  await invoke('export_messages_to_markdown', { filename, title, messages });
}
