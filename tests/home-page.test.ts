import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent } from '@testing-library/react';
import { createMemoryHistory } from '@tanstack/react-router';
import { RouterProvider } from '@tanstack/react-router';

describe('HomePage component', () => {
  const homePagePath = path.resolve('src/components/Home/HomePage.tsx');

  it('should have HomePage component file', () => {
    expect(fs.existsSync(homePagePath)).toBe(true);
  });

  it('should have HomePage export', async () => {
    const { HomePage } = await import('@/components/Home/HomePage');
    expect(HomePage).toBeDefined();
    expect(typeof HomePage).toBe('function');
  });
});

describe('User guide markdown', () => {
  const guidePath = path.resolve('src/docs/user-guide.md');

  it('should have user guide markdown file', () => {
    expect(fs.existsSync(guidePath)).toBe(true);
  });

  it('should contain basic sections', async () => {
    const content = await fs.promises.readFile(guidePath, 'utf-8');
    expect(content).toContain('# 📖 ExoMind 使用指南');
    expect(content).toContain('快速开始');
    expect(content).toContain('功能介绍');
    expect(content).toContain('常见问题');
  });
});
