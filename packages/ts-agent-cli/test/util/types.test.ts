/**
 * Types 工具测试
 *
 * 运行命令:
 *   cd agents/ts && npx vitest run test/util/types.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
    USD_RMB_RATIO,
    NONE,
    noop,
    sleep,
    Optional,
} from '../../src/util/types.js';

describe('types', () => {
    describe('常量', () => {
        it('USD_RMB_RATIO should be 7', () => {
            expect(USD_RMB_RATIO).toBe(7);
        });

        it('NONE should be a symbol', () => {
            expect(typeof NONE).toBe('symbol');
        });
    });

    describe('noop', () => {
        it('should do nothing', () => {
            expect(typeof noop).toBe('function');
            expect(noop()).toBeUndefined();
            expect(noop(1, 2, 3)).toBeUndefined();
        });
    });

    describe('sleep', () => {
        it('should resolve after delay', async () => {
            const before = Date.now();
            await sleep(50);
            const after = Date.now();

            expect(after - before).toBeGreaterThanOrEqual(40);
        });

        it('should return void', async () => {
            const result = await sleep(10);
            expect(result).toBeUndefined();
        });
    });

    describe('Optional type', () => {
        it('should allow null', () => {
            const value: Optional<string> = null;
            expect(value).toBeNull();
        });

        it('should allow undefined', () => {
            const value: Optional<string> = undefined;
            expect(value).toBeUndefined();
        });

        it('should allow value', () => {
            const value: Optional<string> = 'hello';
            expect(value).toBe('hello');
        });
    });
});
