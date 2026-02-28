/**
 * JsonData 工具测试
 *
 * 运行命令:
 *   cd agents/ts && npx vitest run test/util/json.test.ts
 */

import { describe, it, expect } from 'vitest';
import { JsonData, JsonDataWithPath } from '../../src/util/json.js';

describe('JsonData', () => {
    describe('基本序列化', () => {
        it('should serialize to JSON object', () => {
            class User extends JsonData {
                name: string = '';
                age: number = 0;
            }

            const user = new User();
            user.name = 'Alice';
            user.age = 30;

            const json = user.intoJson();

            expect(json).toEqual({ name: 'Alice', age: 30 });
        });

        it('should deserialize from JSON object', () => {
            class User extends JsonData {
                name: string = '';
                age: number = 0;
            }

            const data = { name: 'Bob', age: 25 };
            const user = JsonData.fromJson(User, data);

            expect(user.name).toBe('Bob');
            expect(user.age).toBe(25);
        });

        it('should serialize to JSON string', () => {
            class User extends JsonData {
                name: string = '';
                age: number = 0;
            }

            const user = new User();
            user.name = 'Charlie';
            user.age = 35;

            const jsonStr = user.json();

            expect(jsonStr).toContain('"name": "Charlie"');
            expect(jsonStr).toContain('"age": 35');
        });

        it('should parse from JSON string', () => {
            class User extends JsonData {
                name: string = '';
                age: number = 0;
            }

            const jsonStr = '{"name": "Diana", "age": 28}';
            const user = JsonData.parse(User, jsonStr);

            expect(user.name).toBe('Diana');
            expect(user.age).toBe(28);
        });
    });

    describe('嵌套 JsonData', () => {
        it('should handle nested JsonData', () => {
            class Address extends JsonData {
                city: string = '';
                zipCode: string = '';
            }

            class User extends JsonData {
                name: string = '';
                address: Address = new Address();
            }

            const data = {
                name: 'Eve',
                address: { city: 'Beijing', zipCode: '100000' }
            };

            const user = JsonData.fromJson(User, data);

            expect(user.name).toBe('Eve');
            expect(user.address.city).toBe('Beijing');
            expect(user.address.zipCode).toBe('100000');
        });
    });

    describe('tryParse 错误处理', () => {
        it('should return null for invalid JSON', () => {
            class User extends JsonData {
                name: string = '';
                age: number = 0;
            }

            const result = JsonData.tryParse(User, 'invalid json');

            expect(result).toBeNull();
        });

        it('should return null for missing fields', () => {
            class User extends JsonData {
                name: string = '';
                age: number = 0;
            }

            // 缺少字段不会报错，只是用默认值
            const data = { name: 'Frank' };
            const user = JsonData.fromJson(User, data);

            expect(user.name).toBe('Frank');
            expect(user.age).toBe(0);
        });
    });
});

describe('JsonDataWithPath', () => {
    describe('路径功能', () => {
        it('should save and load with path', () => {
            class Config extends JsonDataWithPath {
                theme: string = 'light';
                language: string = 'zh';
            }

            // 先保存
            const tempPath = './test-config-' + Date.now() + '.local.json';
            const config = new Config();
            config.theme = 'dark';
            config.language = 'en';

            // 直接设置 filePath
            config.filePath = tempPath;
            config.save();

            // 加载
            const loaded = JsonDataWithPath.load(Config, tempPath);

            expect(loaded.theme).toBe('dark');
            expect(loaded.language).toBe('en');

            // 清理
            const fs = require('fs');
            fs.unlinkSync(tempPath);
        });

        it('should handle loadOrNew', () => {
            class Config extends JsonDataWithPath {
                theme: string = 'default';
            }

            const config = JsonDataWithPath.loadOrNew(Config, './nonexistent-temp.json');

            expect(config.theme).toBe('default');
        });

        it('should save without explicit path', () => {
            class Config extends JsonDataWithPath {
                theme: string = 'default';
            }

            const config = new Config();
            const tempPath = './implicit-temp-' + Date.now() + '.json';
            config.filePath = tempPath;
            config.theme = 'auto';

            config.save();

            const loaded = JsonDataWithPath.load(Config, tempPath);
            expect(loaded.theme).toBe('auto');

            const fs = require('fs');
            fs.unlinkSync(tempPath);
        });
    });

    describe('tryLoad 错误处理', () => {
        it('should return null for invalid file', () => {
            class Config extends JsonDataWithPath {
                theme: string = 'default';
            }

            const result = JsonDataWithPath.tryLoad(Config, '/invalid/path.json');

            expect(result).toBeNull();
        });
    });
});
