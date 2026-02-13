import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import 'katex/dist/katex.min.css';

/**
 * 预处理器: 将 ==highlight== 转换为 <mark>highlight</mark>
 * 用于支持 Obsidian 荧光笔风格的高亮语法
 */
function preprocessHighlight(content: string): string {
  return content.replace(/==([^=]+)==/g, '<mark>$1</mark>');
}

/**
 * EventMarkdown - 用于事件日志的 Markdown 渲染组件
 *
 * 支持:
 * - GitHub Flavored Markdown (GFM): 表格、任务列表、删除线等
 * - 软换行: 单行换行也能分段 (remark-breaks)
 * - LaTeX数学公式: $inline$ 和 $$block$$ (remark-math + rehype-katex)
 * - Obsidian高亮: ==highlight== (预处理器 + rehype-raw)
 * - 分界线: --- 和 ===
 *
 * 样式适配:
 * - 紧凑的气泡内样式
 * - 深色模式完整支持
 * - 代码块横向滚动
 * - 小字号
 */
export function EventMarkdown({ content }: { content: string }) {
  // 预处理高亮语法
  const processedContent = preprocessHighlight(content);

  return (
    <div className="
      text-xs sm:text-sm break-words leading-relaxed
      prose prose-xs dark:prose-invert max-w-none
      prose-p:my-0 prose-p:leading-normal
      prose-headings:my-0 prose-headings:font-semibold
      /* Lists - 深色模式 */
      prose-ul:my-0 prose-ul:pl-4 prose-ul:space-y-0
      prose-ol:my-0 prose-ol:pl-4 prose-ol:space-y-0
      prose-li:my-0 prose-li:marker:text-muted-foreground
      /* Code - 深色模式 */
      prose-code:bg-muted prose-code:text-foreground
      prose-code:rounded prose-code:px-1 prose-code:py-0.5
      prose-code:before:content-none prose-code:after:content-none
      prose-code:dark:bg-gray-700 prose-code:dark:text-gray-200
      /* Code blocks - 深色模式 */
      prose-pre:bg-muted prose-pre:text-foreground prose-pre:rounded-lg
      prose-pre:p-2 prose-pre:m-0 prose-pre:overflow-x-auto
      prose-pre:dark:bg-gray-800 prose-pre:dark:text-gray-200
      /* Horizontal rules - 深色模式 */
      prose-hr:my-2 prose-hr:border-t prose-hr:border-muted
      prose-hr:dark:border-gray-600
      /* Blockquotes - 深色模式 */
      prose-blockquote:my-0 prose-blockquote:border-l-2
      prose-blockquote:border-muted prose-blockquote:pl-2
      prose-blockquote:italic prose-blockquote:text-muted-foreground
      prose-blockquote:dark:border-gray-600 prose-blockquote:dark:text-gray-400
      /* Tables - 深色模式 */
      prose-table:my-0 prose-table:overflow-x-auto
      prose-thead:bg-muted prose-thead:dark:bg-gray-700
      prose-tr:border-b prose-tr:border-muted prose-tr:dark:border-gray-600
      prose-th:px-2 prose-th:py-1 prose-th:dark:text-gray-200
      prose-td:px-2 prose-td:py-1 prose-td:dark:text-gray-300
      /* Links - 深色模式 */
      prose-a:text-primary prose-a:underline
      prose-a:dark:text-blue-400
      /* Strong/bold - 深色模式 */
      prose-strong:font-semibold prose-strong:dark:text-gray-100
      /* Deleted/strikethrough */
      prose-del:line-through
      /* ==highlight== - Obsidian荧光笔风格 */
      prose-mark:bg-yellow-200 prose-mark:text-gray-900 prose-mark:rounded prose-mark:px-0.5
      prose-mark:dark:bg-yellow-600/50 prose-mark:dark:text-yellow-100
    ">
      <ReactMarkdown
        remarkPlugins={[
          remarkGfm,
          remarkBreaks,
          remarkMath
        ]}
        rehypePlugins={[
          rehypeKatex,
          // 使用 rehype-raw 允许 <mark> 标签通过
          // 配合 preprocessHighlight 将 ==text== 转换为 <mark>text</mark>
          [rehypeRaw, { allowDangerousHtml: true }]
        ]}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}
