import { describe, expect, it } from 'vitest';
import {
  buildEventPermalink,
  buildEventRecordPath,
  buildEventRefQuoteLine,
  extractEventPermalinksFromContent,
  normalizeEventRefs,
  parseEventPermalink,
  summarizeEventRefExcerpt,
  summarizeEventRefContent,
} from '@/lib/eventlog/event-refs';
import {
  buildEventlogRecordLocatePath,
  buildEventlogRecordPermalink,
  parseEventlogLocateSearch,
} from '@/ui/app/pages/eventlog-route-memory';

describe('event refs helpers', () => {
  it('builds canonical record permalinks and locate paths', () => {
    expect(buildEventRecordPath('evt-1')).toBe('/eventlog/record?event=evt-1&locate=1');
    expect(buildEventlogRecordLocatePath('evt-1')).toBe('/eventlog/record?event=evt-1&locate=1');
    expect(buildEventPermalink('evt-1', 'https://app.local')).toBe('https://app.local/eventlog/record?event=evt-1&locate=1');
    expect(buildEventlogRecordPermalink('evt-1', 'https://app.local')).toBe('https://app.local/eventlog/record?event=evt-1&locate=1');
  });

  it('parses locate search and same-origin permalinks', () => {
    expect(parseEventlogLocateSearch('?event=evt-2&locate=1')).toEqual({
      eventId: 'evt-2',
      shouldLocate: true,
    });
    expect(parseEventPermalink('https://app.local/eventlog/record?event=evt-2&locate=1', 'https://app.local')).toBe('evt-2');
    expect(parseEventPermalink('/tasks?focus=t1', 'https://app.local')).toBeNull();
  });

  it('extracts unique event refs from markdown/app links and preserves order', () => {
    const content = [
      '> 引用：[第一条](/eventlog/record?event=evt-1&locate=1) | 第二行摘要',
      '补充一个裸链接 https://app.local/eventlog/record?event=evt-2&locate=1',
      '重复链接 [再次引用](https://app.local/eventlog/record?event=evt-1&locate=1)',
    ].join('\n');

    expect(extractEventPermalinksFromContent(content, 'https://app.local')).toEqual([
      {
        eventId: 'evt-1',
        href: '/eventlog/record?event=evt-1&locate=1',
        label: '第一条',
      },
      {
        eventId: 'evt-2',
        href: 'https://app.local/eventlog/record?event=evt-2&locate=1',
      },
    ]);
  });

  it('normalizes refs and builds quote markdown lines', () => {
    const refs = normalizeEventRefs([
      { kind: 'event', eventId: ' evt-1 ', summary: ' 第一条引用 ' },
      { kind: 'event', eventId: 'evt-1', summary: '重复' },
      { kind: 'event', eventId: 'evt-2' },
    ]);

    expect(refs).toEqual([
      { kind: 'event', eventId: 'evt-1', summary: '第一条引用' },
      { kind: 'event', eventId: 'evt-2' },
    ]);
    expect(buildEventRefQuoteLine(refs[0]!)).toBe(
      '> 引用：[第一条引用](/eventlog/record?event=evt-1&locate=1)',
    );
    expect(buildEventRefQuoteLine(refs[0]!, 'https://app.local')).toBe(
      '> 引用：[第一条引用](https://app.local/eventlog/record?event=evt-1&locate=1)',
    );
    expect(buildEventRefQuoteLine(refs[0]!, { excerpt: '第二行摘要' })).toBe(
      '> 引用：[第一条引用](/eventlog/record?event=evt-1&locate=1) | 第二行摘要',
    );
  });

  it('summarizes the first non-empty line of referenced content', () => {
    expect(summarizeEventRefContent('\n\n第一行标题\n第二行正文')).toBe('第一行标题');
    expect(summarizeEventRefExcerpt('\n\n第一行标题\n第二行正文\n第三行补充')).toBe('第二行正文 第三行补充');
  });
});
