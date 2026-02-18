import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildAppendedBody,
  parseCommentId,
  parseGithubRef,
  parseRepoFromRemoteUrl,
  readBodyInput,
  resolveMode,
} from '../../../Scripts/dev/github-comment-lib.ts';

describe('github-comment-lib', () => {
  describe('parseCommentId', () => {
    it('parses issuecomment hash format', () => {
      expect(parseCommentId('#issuecomment-3883010944')).toBe('3883010944');
    });

    it('parses full comment url format', () => {
      expect(parseCommentId('https://github.com/exomind-team/exomind/issues/93#issuecomment-3883010944'))
        .toBe('3883010944');
    });

    it('parses raw numeric id format', () => {
      expect(parseCommentId('3883010944')).toBe('3883010944');
    });

    it('throws for invalid locator', () => {
      expect(() => parseCommentId('#discussion_r123')).toThrow(/comment id/i);
    });
  });

  describe('parseGithubRef', () => {
    it('parses issue ref with comment id', () => {
      expect(parseGithubRef('https://github.com/exomind-team/exomind/issues/93#issuecomment-3883010944')).toEqual({
        repo: 'exomind-team/exomind',
        type: 'issue',
        number: 93,
        commentId: '3883010944',
      });
    });

    it('parses pr ref without comment id', () => {
      expect(parseGithubRef('https://github.com/exomind-team/exomind/pull/89')).toEqual({
        repo: 'exomind-team/exomind',
        type: 'pr',
        number: 89,
        commentId: undefined,
      });
    });
  });

  describe('resolveMode', () => {
    it('defaults to create when comment id is absent', () => {
      expect(resolveMode(undefined, undefined)).toBe('create');
    });

    it('defaults to append when comment id is present', () => {
      expect(resolveMode(undefined, '3883010944')).toBe('append');
    });

    it('accepts explicit replace mode', () => {
      expect(resolveMode('replace', '3883010944')).toBe('replace');
    });
  });

  describe('buildAppendedBody', () => {
    it('adds blank line separator for non-empty existing body', () => {
      expect(buildAppendedBody('old text', 'new text')).toBe('old text\n\nnew text');
    });

    it('returns incoming body when existing body is empty', () => {
      expect(buildAppendedBody('', 'new text')).toBe('new text');
    });
  });

  describe('parseRepoFromRemoteUrl', () => {
    it('parses https and ssh remotes', () => {
      expect(parseRepoFromRemoteUrl('https://github.com/exomind-team/exomind.git')).toBe(
        'exomind-team/exomind',
      );
      expect(parseRepoFromRemoteUrl('git@github.com:exomind-team/exomind.git')).toBe(
        'exomind-team/exomind',
      );
    });

    it('supports dotted repository names', () => {
      expect(parseRepoFromRemoteUrl('https://github.com/org/my.repo.git')).toBe('org/my.repo');
      expect(parseRepoFromRemoteUrl('git@github.com:org/my.repo.git')).toBe('org/my.repo');
    });
  });

  describe('readBodyInput encoding guards', () => {
    it('strips UTF-8 BOM from file input', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'gh-comment-lib-'));
      const filePath = join(tempDir, 'bom.md');

      try {
        const utf8WithBom = Buffer.concat([
          Buffer.from([0xef, 0xbb, 0xbf]),
          Buffer.from('中文内容', 'utf8'),
        ]);
        writeFileSync(filePath, utf8WithBom);

        expect(readBodyInput(filePath, undefined)).toBe('中文内容');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('throws when file body contains suspicious lossy question marks', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'gh-comment-lib-'));
      const filePath = join(tempDir, 'lossy.md');

      try {
        writeFileSync(filePath, 'Android ????????????', 'utf8');

        expect(() => readBodyInput(filePath, undefined)).toThrow(/garbled|encoding|乱码/i);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
