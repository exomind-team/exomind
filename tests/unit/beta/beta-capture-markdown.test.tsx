import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BetaCaptureMarkdown } from '@/beta/BetaCaptureMarkdown';
import {
  buildBetaMessageReferenceLine,
  stripBetaMessageReferencesForDisplay,
} from '@/beta/message-references';

const PROFILE = '11111111-1111-4111-8111-111111111111';
const EVENT = '22222222-2222-4222-8222-222222222222';

describe('Beta capture Markdown rendering', () => {
  it('renders common Markdown, soft breaks, GFM tables, and Obsidian highlight', () => {
    const { container } = render(
      <BetaCaptureMarkdown
        content={'# 合成标题\n\n**粗体** 和 *斜体*，==高亮==。\n下一行\n\n[链接](https://example.test)\n\n- 一\n- 二\n\n| 列一 | 列二 |\n| --- | --- |\n| 甲 | 乙 |'}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: '合成标题' })).toBeInTheDocument();
    expect(container.querySelector('strong')).toHaveTextContent('粗体');
    expect(container.querySelector('em')).toHaveTextContent('斜体');
    expect(container.querySelector('mark')).toHaveTextContent('高亮');
    expect(screen.getByRole('link', { name: '链接' })).toHaveAttribute('href', 'https://example.test');
    expect(screen.getByRole('list').querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByRole('table')).toHaveTextContent('甲');
    expect(container.querySelector('br')).not.toBeNull();
  });

  it('uses only double tildes for deletion and supports bold text inside highlights', () => {
    const { container } = render(
      <BetaCaptureMarkdown
        content={'~单波浪线原文~ 与 ~~双波浪线删除~~\n\n==**粗体高亮**== 与 **==高亮粗体==** 与 ==第一== / ==第二=='}
      />,
    );

    expect(container.querySelectorAll('del')).toHaveLength(1);
    expect(container.querySelector('del')).toHaveTextContent('双波浪线删除');
    expect(container).toHaveTextContent('~单波浪线原文~');
    const mark = container.querySelector('mark');
    expect(mark).toHaveTextContent('粗体高亮');
    expect(mark?.querySelector('strong')).toHaveTextContent('粗体高亮');
    expect(container.querySelectorAll('mark')).toHaveLength(4);
    expect(container.querySelector('strong > mark')).toHaveTextContent('高亮粗体');
  });

  it('renders fenced code as source text in a narrow, horizontally scrollable block', () => {
    const htmlSource = '<script>window.__betaMarkdownProbe = true</script>';
    const code = ['```html', htmlSource, 'const marker = "==not-mark== ~not-delete~ ~~not-delete~~ $not-math$";', '```'].join('\n');
    const { container } = render(
      <BetaCaptureMarkdown content={code} />,
    );

    const pre = container.querySelector('pre');
    expect(pre).toHaveTextContent(htmlSource);
    expect(pre).toHaveTextContent('==not-mark== ~not-delete~ ~~not-delete~~ $not-math$');
    expect(pre?.querySelector('mark, del, .katex')).toBeNull();
    expect(pre).toHaveClass('overflow-x-auto', 'max-w-full', 'min-w-0');
    expect(container.querySelector('script')).toBeNull();
  });

  it('renders numeric and symbolic inline math plus scrollable block math through KaTeX', () => {
    const { container } = render(
      <BetaCaptureMarkdown
        content={'Inline $1$、$a^2+b^2=c^2$；未闭合 $x\n\n$$\n\\int_0^1 x\,dx + \\frac{1}{2}\n$$'}
      />,
    );

    expect(container.querySelectorAll('.katex')).toHaveLength(3);
    expect(container.querySelector('.katex-display')).not.toBeNull();
    expect(container.firstElementChild).toHaveClass('[&_.katex-display]:overflow-x-auto');
    expect(container).toHaveTextContent('未闭合 $x');
  });

  it('keeps leading frontmatter as collapsed plain metadata without parsing body YAML', () => {
    const { container } = render(
      <BetaCaptureMarkdown content={'---\ntitle: 合成事件\nsecret: <script>blocked()</script>\n---\n# 正文标题'} />,
    );

    expect(screen.getByText('文档属性')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: '正文标题' })).toBeInTheDocument();
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('pre')).toHaveTextContent('secret: <script>blocked()</script>');
  });

  it('renders nested Obsidian blockquote callouts and their inline formatting', () => {
    const { container } = render(
      <BetaCaptureMarkdown
        content={'> [!WARNING] 注意\n> **加粗** 与 ==高亮==\n> > [!NOTE] 嵌套\n> > 内层提示'}
      />,
    );

    expect(container.querySelector('aside[data-callout="warning"]')).toHaveAttribute('aria-label', '警告提示');
    expect(container.querySelector('aside[data-callout="note"]')).toHaveAttribute('aria-label', '说明提示');
    expect(container.querySelector('aside[data-callout="warning"]')).toHaveTextContent(/注意\s*加粗\s*与\s*高亮/);
    expect(container.querySelector('aside[data-callout="warning"]')).toHaveTextContent('加粗');
    expect(container.querySelector('aside[data-callout="warning"]')).toHaveTextContent('高亮');
    expect(container.querySelector('aside[data-callout="note"]')).toHaveTextContent('内层提示');
  });

  it('keeps wikilinks readable and does not invent a destination', () => {
    const { container } = render(<BetaCaptureMarkdown content="参见 [[未解析的档案链接]]。" />);

    expect(container).toHaveTextContent('[[未解析的档案链接]]');
    expect(container.querySelector('a')).toBeNull();
  });

  it('renders the display projection after removing message reference protocol lines', () => {
    const reference = buildBetaMessageReferenceLine({ profileId: PROFILE, eventId: EVENT, text: '来源摘要' });
    const captured = `## 合成标题\n\n${reference}\n\n正文 **仍然保留**`;
    const displayText = stripBetaMessageReferencesForDisplay(captured);
    const { container } = render(<BetaCaptureMarkdown content={displayText} />);

    expect(screen.getByRole('heading', { level: 2, name: '合成标题' })).toBeInTheDocument();
    expect(container).toHaveTextContent(/正文\s*仍然保留/);
    expect(container).not.toHaveTextContent(reference);
  });

  it('never renders raw HTML as active DOM', () => {
    const { container } = render(
      <BetaCaptureMarkdown content={'<img src=x onerror="window.__betaMarkdownProbe = true">\n<script>window.__betaMarkdownProbe = true</script>\n\n<a href="https://example.test">纯 HTML 链接</a>\n\n正常正文\n\n[不安全链接](javascript:alert(1))'} />,
    );

    expect(container.querySelector('img, script')).toBeNull();
    expect(container.innerHTML).not.toContain('onerror=');
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(screen.queryByRole('link', { name: '纯 HTML 链接' })).toBeNull();
    expect(container).toHaveTextContent('纯 HTML 链接');
    expect(container).toHaveTextContent('正常正文');
  });
});
