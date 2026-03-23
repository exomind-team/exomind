import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('tailwind config', () => {
  const configPath = path.resolve('tailwind.config.js');

  it('should exist at project root', () => {
    expect(fs.existsSync(configPath)).toBe(true);
  });

  it('should export content paths', () => {
    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content).toContain('content:');
    expect(content).toContain('src');
    expect(content).toContain('components');
  });

  it('should extend theme with colors and borderRadius', () => {
    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content).toContain('extend');
    expect(content).toContain('theme');
    expect(content).toContain('colors');
    expect(content).toContain('borderRadius');
  });
});
