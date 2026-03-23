import { describe, expect, it } from 'vitest';
import { buttonVariants } from '@/components/ui/button';

describe('button variants', () => {
  it('should include brand variant classes', () => {
    const className = buttonVariants({ variant: 'brand' });
    expect(className).toContain('bg-brand');
    expect(className).toContain('text-brand-foreground');
  });
});

