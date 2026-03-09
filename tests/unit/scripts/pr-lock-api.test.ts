import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('pr-lock RealGitHubAPI', () => {
  it('runs under tsx on Node ESM and parses labels through gh', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'pr-lock-api-'));
    const ghPath = path.join(tempDir, 'gh');
    const scriptPath = path.join(tempDir, 'invoke-pr-lock-api.mjs');

    writeFileSync(
      ghPath,
      '#!/bin/sh\nprintf \'{"labels":[{"name":"🔒 locked"},{"name":"needs-review"}]}\'\n',
      { encoding: 'utf8', mode: 0o755 },
    );

    writeFileSync(
      scriptPath,
      [
        `import { RealGitHubAPI } from ${JSON.stringify(pathToFileURL(path.join(process.cwd(), 'Scripts/lib/pr-lock-api.ts')).href)};`,
        "const api = new RealGitHubAPI('exomind-team/exomind');",
        'const labels = await api.getLabels(466);',
        'console.log(JSON.stringify(labels));',
      ].join('\n'),
      'utf8',
    );

    try {
      const output = execFileSync(
        'npx',
        ['tsx', scriptPath],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${tempDir}:${process.env.PATH ?? ''}`,
          },
        },
      ).trim();

      expect(JSON.parse(output)).toEqual(['🔒 locked', 'needs-review']);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('creates comments under tsx even when gh pr comment output does not expose a numeric tail', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'pr-lock-api-'));
    const ghPath = path.join(tempDir, 'gh');
    const scriptPath = path.join(tempDir, 'invoke-pr-lock-comment.mjs');

    writeFileSync(
      ghPath,
      [
        '#!/bin/sh',
        'args="$*"',
        'case "$args" in',
        '  *"api repos/exomind-team/exomind/issues/466/comments"* )',
        "    printf '4025911356\\n'",
        '    ;;',
        '  *"pr comment 466"* )',
        '    # Simulate newer gh output that creates the comment but does not print a parseable numeric suffix.',
        '    ;;',
        '  * )',
        '    exit 1',
        '    ;;',
        'esac',
      ].join('\n'),
      { encoding: 'utf8', mode: 0o755 },
    );

    writeFileSync(
      scriptPath,
      [
        `import { RealGitHubAPI } from ${JSON.stringify(pathToFileURL(path.join(process.cwd(), 'Scripts/lib/pr-lock-api.ts')).href)};`,
        "const api = new RealGitHubAPI('exomind-team/exomind');",
        "const id = await api.createComment(466, '[Codex Worker]\\n\\nbody');",
        'console.log(String(id));',
      ].join('\n'),
      'utf8',
    );

    try {
      const output = execFileSync(
        'npx',
        ['tsx', scriptPath],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${tempDir}:${process.env.PATH ?? ''}`,
          },
        },
      ).trim();

      expect(output).toBe('4025911356');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns numeric comment ids from the REST issue comments endpoint', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'pr-lock-api-'));
    const ghPath = path.join(tempDir, 'gh');
    const scriptPath = path.join(tempDir, 'invoke-pr-lock-comments.mjs');

    writeFileSync(
      ghPath,
      [
        '#!/bin/sh',
        'args="$*"',
        'case "$args" in',
        '  *"api repos/exomind-team/exomind/issues/466/comments"* )',
        "    printf '[{\"id\":4025911356,\"body\":\"body\",\"created_at\":\"2026-03-09T00:00:00Z\"}]'",
        '    ;;',
        '  *"pr view 466 --json comments"* )',
        "    printf '{\"comments\":[{\"id\":\"IC_kwDORHTsq87v95WK\",\"body\":\"body\",\"createdAt\":\"2026-03-09T00:00:00Z\"}]}'",
        '    ;;',
        '  * )',
        '    exit 1',
        '    ;;',
        'esac',
      ].join('\n'),
      { encoding: 'utf8', mode: 0o755 },
    );

    writeFileSync(
      scriptPath,
      [
        `import { RealGitHubAPI } from ${JSON.stringify(pathToFileURL(path.join(process.cwd(), 'Scripts/lib/pr-lock-api.ts')).href)};`,
        "const api = new RealGitHubAPI('exomind-team/exomind');",
        'const comments = await api.getComments(466);',
        'console.log(JSON.stringify(comments));',
      ].join('\n'),
      'utf8',
    );

    try {
      const output = execFileSync(
        'npx',
        ['tsx', scriptPath],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${tempDir}:${process.env.PATH ?? ''}`,
          },
        },
      ).trim();

      expect(JSON.parse(output)).toEqual([
        {
          id: 4025911356,
          body: 'body',
          createdAt: '2026-03-09T00:00:00Z',
        },
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
