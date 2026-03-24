/**
 * Functions 工具测试
 *
 * 运行命令:
 *   cd agents/ts && npx vitest run test/util/functions.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
    findFirst,
    unixTimeNow,
    isWindows,
    isLinux,
    awaitSoft,
    tryOr,
    traceFile,
    traceFn,
} from '../../src/util/functions.js';

describe('functions', () => {
    describe('findFirst', () => {
        it('should find first matching element', () => {
            const arr = [1, 2, 3, 4, 5];
            const result = findFirst(x => x > 2, arr);
            expect(result).toBe(3);
        });

        it('should return undefined if not found', () => {
            const arr = [1, 2, 3];
            const result = findFirst(x => x > 10, arr);
            expect(result).toBeUndefined();
        });

        it('should work with empty array', () => {
            const result = findFirst(x => x > 0, []);
            expect(result).toBeUndefined();
        });

        it('should work with strings', () => {
            const arr = ['apple', 'banana', 'cherry'];
            const result = findFirst(s => s.startsWith('b'), arr);
            expect(result).toBe('banana');
        });
    });

    describe('unixTimeNow', () => {
        it('should return number', () => {
            const result = unixTimeNow();
            expect(typeof result).toBe('number');
        });

        it('should be around current time', () => {
            const before = Date.now();
            const result = unixTimeNow();
            const after = Date.now();

            expect(result).toBeGreaterThanOrEqual(before);
            expect(result).toBeLessThanOrEqual(after);
        });
    });

    describe('isWindows', () => {
        it('should return boolean', () => {
            const result = isWindows();
            expect(typeof result).toBe('boolean');
        });
    });

    describe('isLinux', () => {
        it('should return boolean', () => {
            const result = isLinux();
            expect(typeof result).toBe('boolean');
        });
    });

    describe('awaitSoft', () => {
        it('should return value directly', async () => {
            const result = await awaitSoft(42);
            expect(result).toBe(42);
        });

        it('should await promise', async () => {
            const promise = Promise.resolve('hello');
            const result = await awaitSoft(promise);
            expect(result).toBe('hello');
        });

        it('should await object', async () => {
            const obj = { name: 'test' };
            const result = await awaitSoft(obj);
            expect(result).toEqual({ name: 'test' });
        });
    });

    describe('tryOr', () => {
        it('should return value on success', () => {
            const result = tryOr(() => 42);
            expect(result).toBe(42);
        });

        it('should return default on error', () => {
            const result = tryOr(() => {
                throw new Error('test');
            });
            expect(result).toBeNull();
        });

        it('should return custom default', () => {
            const result = tryOr(() => {
                throw new Error('test');
            }, Error, 'fallback');
            expect(result).toBe('fallback');
        });

        it('should catch specific error', () => {
            let called = false;
            const result = tryOr(
                () => {
                    called = true;
                    throw new TypeError('type error');
                },
                TypeError,
                'default'
            );
            expect(result).toBe('default');
            expect(called).toBe(true);
        });
    });

    describe('traceFile', () => {
        it('should return string', () => {
            const result = traceFile();
            expect(typeof result).toBe('string');
        });

        it('should contain file path', () => {
            const result = traceFile();
            // 格式应为 "文件路径:行号"
            expect(result).toMatch(/:\d+$/);
        });
    });

    describe('traceFn', () => {
        it('should return string', () => {
            const result = traceFn();
            expect(typeof result).toBe('string');
        });

        it('should not contain traceFn itself', () => {
            const result = traceFn();
            expect(result).not.toContain('traceFn');
        });

        it('should contain caller function name', () => {
            function caller() {
                return traceFn();
            }
            const result = caller();
            expect(result).toContain('caller');
        });
    });
});
