import { describe, expect, it } from 'vitest';
import { buildDagreRoutedPath } from '@/ui/app/pages/DagreRoutedEdge';

describe('buildDagreRoutedPath', () => {
  it('returns straight line for 2 points', () => {
    const path = buildDagreRoutedPath(0, 0, 100, 100, [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ]);

    expect(path).toBe('M 0,0 L 100,100');
  });

  it('removes collinear intermediate point', () => {
    const path = buildDagreRoutedPath(0, 0, 100, 0, [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ]);

    expect(path).toBe('M 0,0 L 100,0');
  });

  it('removes multiple collinear points in vertical corridor', () => {
    const path = buildDagreRoutedPath(50, 0, 50, 400, [
      { x: 50, y: 0 },
      { x: 50, y: 100 },
      { x: 50, y: 200 },
      { x: 50, y: 300 },
      { x: 50, y: 400 },
    ]);

    expect(path).toBe('M 50,0 L 50,400');
  });

  it('generates L + C + L for single bend', () => {
    const path = buildDagreRoutedPath(0, 0, 100, 200, [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 200 },
    ]);

    expect(path).toContain('M ');
    expect(path).toContain('L ');
    expect(path).toContain('C ');
    expect(path).not.toContain('Q ');
  });

  it('clamps corner radius to half of shortest adjacent segment', () => {
    const path = buildDagreRoutedPath(0, 0, 10, 10, [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
    ], 20);

    const numbers = path.match(/-?\d+\.?\d*/g)?.map(Number) ?? [];
    for (const value of numbers) {
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(11);
    }
  });

  it('handles entry-corridor-exit pattern', () => {
    const path = buildDagreRoutedPath(222, 140, 222, 520, [
      { x: 273, y: 140 },
      { x: 316, y: 200 },
      { x: 316, y: 330 },
      { x: 316, y: 460 },
      { x: 273, y: 520 },
    ]);

    const cubicCount = (path.match(/C /g) ?? []).length;
    expect(cubicCount).toBe(2);
    expect(path.startsWith('M 222,140')).toBe(true);
    expect(path.endsWith('L 222,520')).toBe(true);
  });

  it('replaces dagre boundary points with ReactFlow handle coords', () => {
    const path = buildDagreRoutedPath(100, 0, 100, 300, [
      { x: 130, y: 0 },
      { x: 150, y: 100 },
      { x: 150, y: 200 },
      { x: 130, y: 300 },
    ]);

    expect(path.startsWith('M 100,0')).toBe(true);
    expect(path).toContain('150');
    expect(path).not.toContain('130');
  });
});
