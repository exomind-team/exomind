/**
 * IClipboardPort - 剪贴板读取接口
 *
 * 职责：读取系统/浏览器剪贴板中的文本内容。
 */
export interface IClipboardPort {
  /**
   * 读取剪贴板文本
   */
  readText(): Promise<string>;

  /**
   * 写入文本到剪贴板
   */
  writeText(text: string): Promise<void>;

  /**
   * 检查当前运行环境是否支持读取剪贴板
   */
  isAvailable(): boolean;
}
