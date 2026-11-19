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

  it('inserts into the latest supplied draft without replacing existing text and avoids duplicate references', () => {
    const originalDraft = '我先记下一句话\n继续写的新内容';
    const source = { profileId: PROFILE, eventId: EVENT, text: '原消息第一行\n原消息补充' };
    const inserted = insertBetaMessageReference(originalDraft, source);

    expect(inserted.inserted).toBe(true);
    expect(inserted.text).toBe(buildBetaMessageReferenceLine(source) + '\n' + originalDraft);
    expect(inserted.text).toContain('继续写的新内容');
    expect(insertBetaMessageReference(inserted.text, source)).toMatchObject({ text: inserted.text, inserted: false });
    expect(originalDraft).toBe('我先记下一句话\n继续写的新内容');
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

  it('strips only the display projection of a quote line while leaving source text intact', () => {
    const original = 'my note\n' + buildBetaMessageReferenceLine({ profileId: PROFILE, eventId: EVENT, text: 'quoted sentence\nsource excerpt' });

    expect(stripBetaMessageReferencesForDisplay(original)).toBe('my note\n');
    expect(original).toContain('quoted sentence');
    expect(original).toContain('exomind-beta://event/');
  });
});
