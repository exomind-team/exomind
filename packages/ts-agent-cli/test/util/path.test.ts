/**
 * Path 工具测试
 *
 * 运行命令:
 *   cd agents/ts && npx vitest run test/util/path.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
    findGitRoot,
    getSameParentFile,
    getAgentMdPath,
    getStateJsonPath,
} from '../../src/util/path.js';

describe('path', () => {
    describe('findGitRoot', () => {
        it('should find git root from current directory', () => {
            const result = findGitRoot('./src');
            expect(result).not.toBeNull();
        });

        it('should return string for valid path', () => {
            const result = findGitRoot('./src');
            expect(typeof result).toBe('string');
        });
    });

    describe('getSameParentFile', () => {
        it('should return file path', () => {
            const result = getSameParentFile('test.md', '/some/path');
            expect(result).toMatch(/[\/\\]some[\/\\]path[\/\\]test\.md$/);
        });

        it('should preserve file name', () => {
            const result = getSameParentFile('file.txt', '/dir');
            expect(result).toContain('file.txt');
        });
    });

    describe('getAgentMdPath', () => {
        it('should return agent.md path', () => {
            const result = getAgentMdPath('/test/agent');
            expect(result).toContain('agent.md');
        });
    });

    describe('getStateJsonPath', () => {
        it('should return agent.state.json path', () => {
            const result = getStateJsonPath('/test/agent');
            expect(result).toContain('agent.state.json');
        });
    });
});
