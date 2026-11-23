import { describe, expect, it } from 'vitest';
import {
  buildBetaMessageReferenceLine,
  buildBetaMessageReferenceUri,
  extractBetaMessageReferences,
  insertBetaMessageReference,
  parseBetaMessageReferenceUri,
  removeBetaMessageReference,
  stripBetaMessageReferencesForDisplay,
} from '@/beta/message-references';

const PROFILE = '11111111-1111-4111-8111-111111111111';
const EVENT = '22222222-2222-4222-8222-222222222222';
const OTHER_EVENT = '33333333-3333-4333-8333-333333333333';

describe('Beta message reference protocol', () => {
  it('round trips only a profile and event identity through an exomind-beta URI', () => {
    const uri = buildBetaMessageReferenceUri({ profileId: PROFILE, eventId: EVENT });

    expect(uri).toBe('exomind-beta://event/' + PROFILE + '/' + EVENT);
    expect(parseBetaMessageReferenceUri(uri)).toEqual({ profileId: PROFILE, eventId: EVENT });
    expect(uri).not.toMatch(/token|invite|secret|quoted|original body/i);
  });

  it.each([
    'https://example.test/event',
    'exomind-beta://event/' + PROFILE + '/' + EVENT + '?token=secret',
    'exomind-beta://event/' + PROFILE + '/' + EVENT + '#body',
    'exomind-beta://other/' + PROFILE + '/' + EVENT,
    'exomind-beta://event/' + PROFILE + '/' + EVENT + '/extra',
    'exomind-beta://event/' + PROFILE + '/%2F' + EVENT,
    'exomind-beta://event/' + PROFILE + '/not-a-uuid',
    'exomind-beta://user@event/' + PROFILE + '/' + EVENT,
    'exomind-beta://event/' + PROFILE + '/' + EVENT + ':42',
  ])('rejects invalid or credential-bearing URI %s', (uri) => {
    expect(parseBetaMessageReferenceUri(uri)).toBeNull();
  });

  it('keeps readable quote text separate from the locator identity and original body', () => {
    const original = 'A sentence to remember\nThe supporting detail.';
    const line = buildBetaMessageReferenceLine({ profileId: PROFILE, eventId: EVENT, text: original });

    expect(line).toBe('> 引用：[A sentence to remember](exomind-beta://event/' + PROFILE + '/' + EVENT + ') | The supporting detail.');
    expect(parseBetaMessageReferenceUri(line.match(/\(([^)]+)\)/)?.[1] ?? '')).toEqual({
      profileId: PROFILE,
      eventId: EVENT,
    });
    expect(original).toBe('A sentence to remember\nThe supporting detail.');
  });

  it('stores an explicit attachment label and metadata without inventing a body excerpt', () => {
    const source = { profileId: PROFILE, eventId: EVENT, text: '', label: '附件记录', metadata: '附件名：receipt.pdf' };
    const line = buildBetaMessageReferenceLine(source);
    expect(line).toBe('> 引用：[附件记录](' + buildBetaMessageReferenceUri(source) + ') · 元数据：附件名：receipt.pdf');
    const [reference] = extractBetaMessageReferences(line);
    expect(reference).toMatchObject({ label: '附件记录', metadata: '附件名：receipt.pdf', isQuoteLine: true });
    expect(reference).not.toHaveProperty('excerpt');
  });

  it('inserts into the latest supplied draft without replacing existing text and avoids duplicate references', () => {
    const originalDraft = '我先记下一句话\n继续写的新内容';
    const source = { profileId: PROFILE, eventId: EVENT, text: '原消息第一行\n原消息补充' };
    const inserted = insertBetaMessageReference(originalDraft, source);

    expect(inserted.inserted).toBe(true);
    expect(inserted.text).toBe(buildBetaMessageReferenceLine(source) + '\n\n' + originalDraft);
    expect(inserted.text).toContain('继续写的新内容');
    expect(insertBetaMessageReference(inserted.text, source)).toMatchObject({ text: inserted.text, inserted: false });
    expect(originalDraft).toBe('我先记下一句话\n继续写的新内容');
  });

  it('separates a reference block from a body that already starts with blank lines', () => {
    const source = { profileId: PROFILE, eventId: EVENT, text: '合成引用摘要' };
    const body = '\r\n\n  已有正文';
    const inserted = insertBetaMessageReference(body, source);

    expect(inserted.text).toBe(buildBetaMessageReferenceLine(source) + '\n\n  已有正文');
    expect(inserted.cursorOffsetDelta).toBe(buildBetaMessageReferenceLine(source).length + 2 - 3);
    expect(insertBetaMessageReference(inserted.text, source)).toMatchObject({
      text: inserted.text,
      inserted: false,
      cursorOffsetDelta: 0,
    });
  });

  it('keeps an empty draft as a standalone quote block with a blank cursor line', () => {
    const source = { profileId: PROFILE, eventId: EVENT, text: '合成引用摘要' };
    const line = buildBetaMessageReferenceLine(source);
    expect(insertBetaMessageReference('', source)).toMatchObject({
      text: line + '\n\n',
      referenceLine: line,
      inserted: true,
      cursorOffsetDelta: line.length + 2,
    });
  });

  it('keeps a quote preview readable and bounded beyond the 128 KiB UTF-8 source boundary', () => {
    const sourceText = '🧪'.repeat(32_769) + '\n' + '第二行保留为可读摘要';
    expect(new TextEncoder().encode(sourceText).byteLength).toBeGreaterThan(128 * 1024);

    const line = buildBetaMessageReferenceLine({ profileId: PROFILE, eventId: EVENT, text: sourceText });
    const [reference] = extractBetaMessageReferences(line);

    expect(reference.label).toBe('🧪'.repeat(47) + '…');
    expect(reference.excerpt).toBe('第二行保留为可读摘要');
    expect(new TextEncoder().encode(line).byteLength).toBeLessThan(512);
    expect(line).not.toContain(sourceText.slice(-64));
  });

  it('extracts quoted and pasted references without exposing their IDs as display labels', () => {
    const quoted = buildBetaMessageReferenceLine({ profileId: PROFILE, eventId: EVENT, text: 'Readable summary\nA useful excerpt' });
    const pasted = buildBetaMessageReferenceUri({ profileId: PROFILE, eventId: OTHER_EVENT });
    const refs = extractBetaMessageReferences(quoted + '\n' + pasted);

    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ profileId: PROFILE, eventId: EVENT, label: 'Readable summary', excerpt: 'A useful excerpt', isQuoteLine: true });
    expect(refs[1]).toMatchObject({ profileId: PROFILE, eventId: OTHER_EVENT, isQuoteLine: false });
    expect(refs[0].label).not.toContain(PROFILE);
  });

  it('keeps a nested reference mentioned by the quoted source as quote text only', () => {
    const nestedUri = buildBetaMessageReferenceUri({ profileId: PROFILE, eventId: OTHER_EVENT });
    const quoted = buildBetaMessageReferenceLine({
      profileId: PROFILE,
      eventId: EVENT,
      text: 'Readable summary\nSource text mentions ' + nestedUri,
    });

    expect(extractBetaMessageReferences(quoted).map(({ eventId }) => eventId)).toEqual([EVENT]);
  });

  it('removes only the selected reference line from the current draft', () => {
    const selected = buildBetaMessageReferenceLine({ profileId: PROFILE, eventId: EVENT, text: 'Quoted sentence\nAdditional source context' });
    const other = buildBetaMessageReferenceLine({ profileId: PROFILE, eventId: OTHER_EVENT, text: 'Keep this other quote' });
    const currentDraft = 'new input above\n' + selected + '\nnew input typed after the quote\n' + other;
    const next = removeBetaMessageReference(currentDraft, { profileId: PROFILE, eventId: EVENT });

    expect(next).toBe('new input above\nnew input typed after the quote\n' + other);
    expect(next).toContain('new input typed after the quote');
    expect(next).toContain(OTHER_EVENT);
  });

  it('removes a pasted link token without removing neighboring draft text', () => {
    const uri = buildBetaMessageReferenceUri({ profileId: PROFILE, eventId: EVENT });
    const draft = '请回看这里 ' + uri + ' 然后继续记录';

    expect(removeBetaMessageReference(draft, { profileId: PROFILE, eventId: EVENT })).toBe('请回看这里  然后继续记录');
  });

  it('strips quote metadata from the display projection while preserving the source text', () => {
    const original = 'my note\n' + buildBetaMessageReferenceLine({ profileId: PROFILE, eventId: EVENT, text: 'quoted sentence\nsource excerpt' });

    expect(stripBetaMessageReferencesForDisplay(original)).toBe('my note');
    expect(original).toContain('quoted sentence');
    expect(original).toContain('exomind-beta://event/');
  });

  it('removes leading and trailing blank space left by reference rows without collapsing body paragraphs', () => {
    const first = buildBetaMessageReferenceLine({ profileId: PROFILE, eventId: EVENT, text: 'first source' });
    const second = buildBetaMessageReferenceLine({ profileId: PROFILE, eventId: OTHER_EVENT, text: 'second source' });
    const original = ` \n\n${first}\n\n${second}\n\nFirst paragraph\n\nSecond paragraph\n\n `;

    expect(stripBetaMessageReferencesForDisplay(original)).toBe('First paragraph\n\nSecond paragraph');
    expect(original).toContain(first);
    expect(original).toContain(second);
  });
});
