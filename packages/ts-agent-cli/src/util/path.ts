/**
 * Path - 路径工具函数
 *
 * 包含 findGitRoot, getSameParentFile, getAgentMdPath, getStateJsonPath
 */

import fs from 'fs';
import path from 'path';

// ============ 路径工具 ============

/**
 * 从 startPath 向上查找包含 .git 的目录
 * @param startPath - 起始路径
 * @returns git 根目录或 null
 */
export function findGitRoot(startPath: string): string | null {
  const path = require('path') as typeof import('path');
  let current = path.resolve(startPath);

  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(current, '.git'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

/**
 * 获取与脚本同目录下的文件路径
 * @param fileName - 文件名
 * @param agentDir - 目录路径
 * @returns 文件路径
 */
export function getSameParentFile(fileName: string, agentDir: string): string {
  return path.join(agentDir, fileName);
}

/**
 * 获取同目录下的 agent.md 绝对路径
 * @param agentDir - Agent 目录
 * @param fileName - 文件名
 * @returns 路径字符串
 */
export function getAgentMdPath(agentDir: string, fileName: string = 'agent.md'): string {
  return getSameParentFile(fileName, agentDir);
}

/**
 * 获取同目录下的状态文件路径
 * @param agentDir - Agent 目录
 * @param fileName - 文件名
 * @returns 路径字符串
 */
export function getStateJsonPath(agentDir: string, fileName: string = 'agent.state.json'): string {
  return getSameParentFile(fileName, agentDir);
}
