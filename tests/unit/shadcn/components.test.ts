import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('shadcn components.json', () => {
  const configPath = path.resolve('components.json');

  it('should exist at project root', () => {
    expect(fs.existsSync(configPath)).toBe(true);
  });

  it('should have valid JSON structure', () => {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);

    expect(config).toHaveProperty('style');
    expect(config).toHaveProperty('rsc');
    expect(config).toHaveProperty('tsx');
    expect(config).toHaveProperty('tailwind');
    expect(config).toHaveProperty('baseColor');
    expect(config).toHaveProperty('cssVariables');
    expect(config).toHaveProperty('aliases');
  });

  it('should configure tailwind correctly', () => {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);

    expect(config.tailwind).toBeDefined();
    expect(config.tailwind.config).toBe('tailwind.config.js');
    expect(config.tailwind.css).toBe('src/index.css');
  });

  it('should define path aliases', () => {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);

    expect(config.aliases).toHaveProperty('utils');
    expect(config.aliases).toHaveProperty('components');
    expect(config.aliases).toHaveProperty('ui');
    expect(config.aliases).toHaveProperty('lib');
    expect(config.aliases).toHaveProperty('hooks');
  });
});
