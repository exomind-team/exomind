/**
 * Extract 工具测试
 *
 * 运行命令:
 *   cd agents/ts && npx vitest run test/util/extract.test.ts
 */

import { describe, it, expect } from 'vitest';
import { Extract, extract, ExtractAsync } from '../../src/util/extract.js';

describe('Extract - Generator 返回值提取工具', () => {
    // ============ 基本用法 ============
    describe('基本用法', () => {
        it('should collect all yielded values', () => {
            function* gen(): Generator<number, string, unknown> {
                yield 1;
                yield 2;
                yield 3;
                return 'done';
            }

            const result = new Extract(gen()).collect();

            expect(result.generated).toEqual([1, 2, 3]);
            expect(result.returns).toBe('done');
        });

        it('should handle empty generator', () => {
            function* empty(): Generator<never, string, unknown> {
                return 'empty-result';
            }

            const result = new Extract(empty()).collect();

            expect(result.generated).toEqual([]);
            expect(result.returns).toBe('empty-result');
        });
    });

    // ============ 便捷函数 ============
    describe('便捷函数 extract()', () => {
        it('should work with factory function', () => {
            function* gen(): Generator<string, number, unknown> {
                yield 'a';
                yield 'b';
                return 42;
            }

            const result = extract(gen()).collect();

            expect(result.generated).toEqual(['a', 'b']);
            expect(result.returns).toBe(42);
        });
    });

    // ============ 边界条件 ============
    describe('边界条件', () => {
        it('should handle single yield with return', () => {
            function* single(): Generator<number, string, unknown> {
                yield 42;
                return 'finished';
            }

            const result = new Extract(single()).collect();

            expect(result.generated).toEqual([42]);
            expect(result.returns).toBe('finished');
        });

        it('should handle return without yield', () => {
            function* noYield(): Generator<never, string, unknown> {
                return 'immediate';
            }

            const result = new Extract(noYield()).collect();

            expect(result.generated).toEqual([]);
            expect(result.returns).toBe('immediate');
        });

        it('should handle undefined return', () => {
            function* noReturn(): Generator<number, void, unknown> {
                yield 1;
                yield 2;
            }

            const result = new Extract(noReturn()).collect();

            expect(result.generated).toEqual([1, 2]);
            // 生成器没有 return 语句时，returns 是 undefined
            expect(result.returns).toBeUndefined();
        });
    });

    // ============ 迭代器接口 ============
    describe('Iterable 接口', () => {
        it('should support for...of iteration', () => {
            function* gen(): Generator<number, string, unknown> {
                yield 1;
                yield 2;
                return 'done';
            }

            const items: number[] = [];
            for (const item of new Extract(gen())) {
                items.push(item);
            }

            expect(items).toEqual([1, 2]);
        });

        it('should support spread operator', () => {
            function* gen(): Generator<number, string, unknown> {
                yield 1;
                yield 2;
                return 'done';
            }

            const items = [...new Extract(gen())];
            expect(items).toEqual([1, 2]);
        });

        it('should track length correctly', () => {
            function* gen(): Generator<number, string, unknown> {
                yield 1;
                yield 2;
                yield 3;
                return 'done';
            }

            const extractor = new Extract(gen());
            expect(extractor.length).toBe(0);

            for (const _ of extractor) { }

            expect(extractor.length).toBe(3);
        });
    });

    // ============ consume 方法 ============
    describe('consume() 方法', () => {
        it('should return the returns value', () => {
            function* gen(): Generator<number, string, unknown> {
                yield 1;
                yield 2;
                return 'result';
            }

            const result = new Extract(gen()).consume();

            expect(result).toBe('result');
        });
    });

    // ============ 性能测试 ============
    describe('性能', () => {
        it('should handle 1000 yields efficiently', () => {
            function* large(): Generator<number, string, unknown> {
                for (let i = 0; i < 1000; i++) {
                    yield i;
                }
                return 'done';
            }

            const start = performance.now();
            const result = new Extract(large()).collect();
            const elapsed = performance.now() - start;

            expect(result.generated.length).toBe(1000);
            expect(elapsed).toBeLessThan(100);
        });

        it('should handle 10000 yields within reasonable time', () => {
            function* veryLarge(): Generator<number, string, unknown> {
                for (let i = 0; i < 10000; i++) {
                    yield i;
                }
                return 'done';
            }

            const start = performance.now();
            const result = new Extract(veryLarge()).collect();
            const elapsed = performance.now() - start;

            expect(result.generated.length).toBe(10000);
            expect(elapsed).toBeLessThan(500);
        });
    });

    // ============ 嵌套生成器 ============
    describe('嵌套生成器', () => {
        it('should handle generator yielding generators', () => {
            function* inner(): Generator<number, string, unknown> {
                yield 1;
                yield 2;
                return 'inner-done';
            }

            function* outer(): Generator<Generator<number, string, unknown>, string[], unknown> {
                yield inner();
                yield inner();
                return ['outer-done'];
            }

            const result = new Extract(outer()).collect();

            expect(result.generated).toHaveLength(2);
            expect(result.returns).toEqual(['outer-done']);
        });
    });

    // ============ 异步迭代器 ============
    describe('ExtractorAsync - 异步迭代器', () => {
        it('should collect async generated values', async () => {
            async function* asyncGen(): AsyncGenerator<number, string, unknown> {
                yield 1;
                yield 2;
                return 'async-done';
            }

            const result = await new ExtractAsync(asyncGen()).collect();

            expect(result).toEqual([1, 2]);
        });

        it('should collect with generateAll()', async () => {
            async function* asyncGen(): AsyncGenerator<number, string, unknown> {
                yield 1;
                yield 2;
                return 'async-done';
            }

            const result = await new ExtractAsync(asyncGen()).generateAll();

            expect(result.generated).toEqual([1, 2]);
            expect(result.returns).toBe('async-done');
        });

        it('should consume async returns', async () => {
            async function* asyncGen(): AsyncGenerator<number, string, unknown> {
                yield 1;
                yield 2;
                return 'async-result';
            }

            const result = await new ExtractAsync(asyncGen()).consume();

            expect(result).toBe('async-result');
        });

        it('should work with extract factory', async () => {
            async function* asyncGen(): AsyncGenerator<number, string, unknown> {
                yield 1;
                yield 2;
                return 'factory-done';
            }

            const result = await extract(asyncGen()).generateAll();

            expect(result.generated).toEqual([1, 2]);
            expect(result.returns).toBe('factory-done');
        });
    });

    // ============ 错误处理 ============
    describe('错误处理', () => {
        it('should propagate errors from generator', () => {
            function* errorGen(): Generator<never, never, never> {
                throw new Error('Test error');
            }

            const extractor = new Extract(errorGen());

            expect(() => {
                for (const _ of extractor) { }
            }).toThrow('Test error');
        });

        it('should propagate errors from async generator', async () => {
            async function* asyncErrorGen(): AsyncGenerator<never, never, never> {
                throw new Error('Async test error');
            }

            const extractor = new ExtractAsync(asyncErrorGen());

            await expect(async () => {
                await extractor.collect();
            }).rejects.toThrow('Async test error');
        });
    });
});
