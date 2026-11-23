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

  it('renders fenced code as source text in a narrow, horizontally scrollable block', () => {
    const htmlSource = '<script>window.__betaMarkdownProbe = true</script>';
    const code = ['```html', htmlSource, 'const marker = "**still code**";', '```'].join('\n');
    const { container } = render(
      <BetaCaptureMarkdown content={code} />,
    );

    const pre = container.querySelector('pre');
    expect(pre).toHaveTextContent(htmlSource);
    expect(pre).toHaveTextContent('**still code**');
    expect(pre).toHaveClass('overflow-x-auto', 'max-w-full', 'min-w-0');
    expect(container.querySelector('script')).toBeNull();
  });

  it('renders inline and block math through KaTeX', () => {
    const { container } = render(<BetaCaptureMarkdown content={'Inline $a^2+b^2=c^2$.\n\n$$\n\\int_0^1 x\,dx\n$$'} />);

    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2);
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

  it('renders Obsidian blockquote callouts as labeled asides', () => {
    const { container } = render(<BetaCaptureMarkdown content={'> [!WARNING] 注意\n> 保留提示内容'} />);

    expect(container.querySelector('aside[data-callout="warning"]')).toHaveAttribute('aria-label', '警告提示');
    expect(container.querySelector('aside[data-callout="warning"]')).toHaveTextContent(/注意\s*保留提示内容/);
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
      <BetaCaptureMarkdown content={'<img src=x onerror="window.__betaMarkdownProbe = true">\n<script>window.__betaMarkdownProbe = true</script>\n\n正常正文\n\n[不安全链接](javascript:alert(1))'} />,
    );

    expect(container.querySelector('img, script')).toBeNull();
    expect(container.innerHTML).not.toContain('onerror=');
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container).toHaveTextContent('正常正文');
  });
});
