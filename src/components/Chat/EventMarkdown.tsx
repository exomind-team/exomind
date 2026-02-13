import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

/**
 * EventMarkdown - 用于事件日志的 Markdown 渲染组件
 *
 * 支持:
 * - GitHub Flavored Markdown (GFM): 表格、任务列表、删除线等
 * - 软换行: 单行换行也能分段 (remark-breaks)
 * - 分界线: --- 和 ===
 *
 * 样式适配:
 * - 紧凑的气泡内样式
 * - 代码块横向滚动
 * - 小字号
 */
export function EventMarkdown({ content }: { content: string }) {
  return (
    <div className="
      text-xs sm:text-sm break-words leading-relaxed
      prose prose-xs dark:prose-invert max-w-none
      prose-p:my-0 prose-p:leading-normal
      prose-headings:my-0 prose-headings:font-semibold
      prose-ul:my-0 prose-ul:pl-4 prose-ul:space-y-0
      prose-ol:my-0 prose-ol:pl-4 prose-ol:space-y-0
      prose-li:my-0
      prose-code:bg-muted/80 prose-code:text-foreground prose-code:rounded prose-code:px-1 prose-code:py-0.5 prose-code:before:content-none prose-code:after:content-none
      prose-pre:bg-muted/80 prose-pre:text-foreground prose-pre:rounded-lg prose-pre:p-2 prose-pre:m-0 prose-pre:overflow-x-auto
      prose-hr:my-2 prose-hr:border-t prose-hr:border-muted/50
      prose-blockquote:my-0 prose-blockquote:border-l-2 prose-blockquote:border-muted/50 prose-blockquote:pl-2 prose-blockquote:italic
      prose-table:my-0 prose-table:overflow-x-auto
      prose-thead:bg-muted/50
      prose-tr:border-b prose-tr:border-muted/30
      prose-th:px-2 prose-th:py-1
      prose-td:px-2 prose-td:py-1
      prose-a:text-primary prose-a:underline
      prose-strong:font-semibold
      prose-del:line-through
    ">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
