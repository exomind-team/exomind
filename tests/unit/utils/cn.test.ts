import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/utils';

describe('cn utility function', () => {
  it('should merge two class names', () => {
    expect(cn('base', 'active')).toBe('base active');
  });

  it('should handle conditional classes', () => {
    expect(cn('base', true && 'conditional', false && 'hidden')).toBe('base conditional');
  });

  it('should handle empty inputs', () => {
    expect(cn()).toBe('');
  });

  it('should handle undefined and null', () => {
    expect(cn('base', undefined, null, 'active')).toBe('base active');
  });

  it('should merge objects with tailwind-merge pattern', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });
});
