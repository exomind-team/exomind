import type { HTMLAttributes, ReactNode } from 'react';
import type { Root } from 'mdast';
import type { Plugin } from 'unified';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

type AstNode = {
  type: string;
  value?: string;
  children?: AstNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, string>;
  };
};

const highlightObsidianSyntax: Plugin<[], Root> = () => (root) => {
  const appendText = (nodes: AstNode[], value: string) => {
    if (!value) return;
    const previous = nodes[nodes.length - 1];
    if (previous?.type === 'text' && typeof previous.value === 'string') {
      previous.value += value;
      return;
    }
    nodes.push({ type: 'text', value });
  };

  const visit = (node: AstNode) => {
    if (!node.children) return;

    const transformed: AstNode[] = [];
    let open: AstNode | null = null;
    let pending: AstNode[] = [];
    for (const child of node.children) {
      if (child.type !== 'text' || typeof child.value !== 'string') {
        if (open) {
          open.children!.push(child);
          pending.push(child);
        } else {
          transformed.push(child);
        }
        continue;
      }

      let offset = 0;
      while (offset < child.value.length) {
        const marker = child.value.indexOf('==', offset);
        if (marker < 0) {
          const tail = child.value.slice(offset);
          if (open) {
            appendText(open.children!, tail);
            appendText(pending, tail);
          } else {
            appendText(transformed, tail);
          }
          offset = child.value.length;
          break;
        }

        const before = child.value.slice(offset, marker);
        if (open) {
          appendText(open.children!, before);
          appendText(pending, before);
          if (open.children!.length > 0) {
            transformed.push(open);
            open = null;
            pending = [];
          } else {
            appendText(transformed, '====');
            open = null;
            pending = [];
          }
        } else {
          appendText(transformed, before);
          open = { type: 'emphasis', data: { hName: 'mark' }, children: [] };
          pending = [{ type: 'text', value: '==' }];
        }
        offset = marker + 2;
      }
    }
    if (open) transformed.push(...pending);

    node.children = transformed;
    for (const child of node.children) visit(child);
  };

  visit(root as unknown as AstNode);
};

const CALLOUT_KINDS = new Set([
  'note', 'abstract', 'summary', 'info', 'todo', 'tip', 'success', 'question',
  'warning', 'failure', 'danger', 'bug', 'example', 'quote',
]);
const CALLOUT_LABELS: Record<string, string> = {
  note: '说明', abstract: '摘要', summary: '总结', info: '信息', todo: '待办', tip: '提示',
  success: '成功', question: '问题', warning: '警告', failure: '失败', danger: '危险',
  bug: '缺陷', example: '示例', quote: '引用',
};

const obsidianCallouts: Plugin<[], Root> = () => (root) => {
  const visit = (node: AstNode) => {
    if (!node.children) return;

    for (const child of node.children) {
      if (child.type === 'blockquote') {
        const firstParagraph = child.children?.find((item) => item.type === 'paragraph');
        const firstText = firstParagraph?.children?.[0];
        if (firstText?.type === 'text' && typeof firstText.value === 'string') {
          const match = /^\[!([A-Z]+)\](?:[+-])?\s*/i.exec(firstText.value);
          const kind = match?.[1].toLowerCase();
          if (match && kind && CALLOUT_KINDS.has(kind)) {
            firstText.value = firstText.value.slice(match[0].length);
            child.data = {
              ...child.data,
              hName: 'aside',
              hProperties: {
                ...child.data?.hProperties,
                'data-callout': kind,
                'aria-label': `${CALLOUT_LABELS[kind] ?? '提示'}提示`,
              },
            };
          }
        }
      }
      visit(child);
    }
  };

  visit(root as unknown as AstNode);
};

function splitLeadingFrontmatter(content: string): { frontmatter: string | null; body: string } {
  const normalized = content.replace(/^\uFEFF/, '');
  const match = /^---[\t ]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[\t ]*(?:\r?\n|$)/.exec(normalized);
  if (!match) return { frontmatter: null, body: normalized };
  return { frontmatter: match[1], body: normalized.slice(match[0].length) };
}

const markdownComponents = {
  h1: ({ children }: { children?: ReactNode }) => <h1 className="my-1 text-base font-semibold leading-snug text-strong">{children}</h1>,
  h2: ({ children }: { children?: ReactNode }) => <h2 className="my-1 text-sm font-semibold leading-snug text-strong">{children}</h2>,
  h3: ({ children }: { children?: ReactNode }) => <h3 className="my-1 text-sm font-semibold leading-snug text-strong">{children}</h3>,
  h4: ({ children }: { children?: ReactNode }) => <h4 className="my-1 text-sm font-semibold text-strong">{children}</h4>,
  h5: ({ children }: { children?: ReactNode }) => <h5 className="my-1 text-xs font-semibold text-strong">{children}</h5>,
  h6: ({ children }: { children?: ReactNode }) => <h6 className="my-1 text-xs font-semibold text-strong">{children}</h6>,
  p: ({ children }: { children?: ReactNode }) => <p className="my-1 break-words [overflow-wrap:anywhere]">{children}</p>,
  ul: ({ children }: { children?: ReactNode }) => <ul className="my-1 list-disc space-y-1 pl-5 marker:text-muted">{children}</ul>,
  ol: ({ children, start }: { children?: ReactNode; start?: number }) => <ol start={start} className="my-1 list-decimal space-y-1 pl-5 marker:text-muted">{children}</ol>,
  li: ({ children }: { children?: ReactNode }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }: { children?: ReactNode }) => <strong className="font-semibold text-strong">{children}</strong>,
  em: ({ children }: { children?: ReactNode }) => <em className="italic">{children}</em>,
  a: ({ children, href }: { children?: ReactNode; href?: string }) => (
    <a href={href} className="break-all text-primary underline underline-offset-2">{children}</a>
  ),
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="my-1 border-l-2 border-input pl-3 text-secondary">{children}</blockquote>
  ),
  aside: ({ children, node: _node, ...props }: HTMLAttributes<HTMLElement> & { node?: unknown }) => (
    <aside {...props} className="my-2 rounded-r-md border-l-4 border-primary bg-surface p-2 text-secondary">
      {children}
    </aside>
  ),
  pre: ({ children }: { children?: ReactNode }) => (
    <pre className="my-2 min-w-0 max-w-full overflow-x-auto rounded-lg bg-surface p-3 text-xs leading-relaxed">
      {children}
    </pre>
  ),
  code: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <code className={`rounded bg-surface px-1 py-0.5 font-mono text-xs ${className ?? ''}`}>
      {children}
    </code>
  ),
  table: ({ children }: { children?: ReactNode }) => (
    <div className="my-2 min-w-0 max-w-full overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs leading-relaxed">{children}</table>
    </div>
  ),
  th: ({ children }: { children?: ReactNode }) => <th className="border-b border-input bg-surface px-2 py-1 font-semibold">{children}</th>,
  td: ({ children }: { children?: ReactNode }) => <td className="border-b border-input px-2 py-1 align-top">{children}</td>,
  mark: ({ children }: { children?: ReactNode }) => <mark className="rounded bg-yellow-200 px-0.5 text-gray-900 dark:bg-yellow-600/50 dark:text-yellow-100">{children}</mark>,
  hr: () => <hr className="my-2 border-input" />,
};

/**
 * Safe Markdown rendering for user-authored Beta captures.
 * Raw HTML stays disabled. Obsidian wikilinks are intentionally left as text
 * until Beta has an explicit profile-scoped note/event resolver.
 */
export function BetaCaptureMarkdown({ content }: { content: string }) {
  const { frontmatter, body } = splitLeadingFrontmatter(content);

  return (
    <div className="beta-capture-markdown exomind-selectable min-w-0 max-w-full break-words text-[13px] leading-relaxed [overflow-wrap:anywhere] [&_.katex-display]:max-w-full [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden">
      {frontmatter !== null && (
        <details className="mb-2 text-xs text-muted">
          <summary className="cursor-pointer select-none">文档属性</summary>
          <pre className="my-1 min-w-0 max-w-full overflow-x-auto rounded bg-surface p-2 font-mono">
            {frontmatter}
          </pre>
        </details>
      )}
      {body ? (
        <ReactMarkdown
          skipHtml
          remarkPlugins={[
            [remarkGfm, { singleTilde: false }],
            remarkBreaks,
            remarkMath,
            highlightObsidianSyntax,
            obsidianCallouts,
          ]}
          rehypePlugins={[rehypeKatex]}
          components={markdownComponents}
        >
          {body}
        </ReactMarkdown>
      ) : null}
    </div>
  );
}
