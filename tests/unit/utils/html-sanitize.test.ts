import { escapeHtml } from '@/lib/utils/html-sanitize';

describe('escapeHtml', () => {
  it('should escape script tags', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('should escape img tags with onerror', () => {
    const input = '<img src=x onerror=alert(1)>';
    const escaped = escapeHtml(input);
    // Should escape < and > but not inside attribute values
    expect(escaped).toContain('&lt;img');
    expect(escaped).toContain('onerror');
  });

  it('should escape special characters', () => {
    expect(escapeHtml('<>&"\' tests')).toBe(
      '&lt;&gt;&amp;&quot;&#39; tests'
    );
  });

  it('should handle empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('should handle normal text', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World');
  });
});
