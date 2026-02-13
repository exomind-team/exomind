import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

/**
 * 自定义 remark 插件: 支持 ==highlight== 语法 (Obsidian 荧光笔风格)
 *
 * 将 ==text== 转换为 <mark> 标签
 * 修复: 避免 DOM 嵌套问题和无限递归
 */
function remarkHighlight() {
  return (tree: any) => {
    const visited = new Set();

    const visitor = (node: any) => {
      if (visited.has(node)) return;
      visited.add(node);

      // 只处理 text 节点
      if (node.type === 'text' && node.value && node.value.includes('==')) {
        const children = [];
        let remaining = node.value;
        let pos = 0;

        while (pos < remaining.length) {
          const start = remaining.indexOf('==', pos);
          if (start === -1) {
            // 没有更多的高亮标记，添加剩余文本
            if (pos < remaining.length) {
              children.push({ type: 'text', value: remaining.slice(pos) });
            }
            break;
          }

          // 添加高亮之前的文本
          if (start > pos) {
            children.push({ type: 'text', value: remaining.slice(pos, start) });
          }

          const end = remaining.indexOf('==', start + 2);
          if (end === -1) {
            // 没有闭合的 ==，将剩余作为文本
            children.push({ type: 'text', value: remaining.slice(start) });
            break;
          }

          // 添加高亮文本 - 使用 text 类型而不是 html，避免安全问题
          const highlightText = remaining.slice(start + 2, end);
          children.push({
            type: 'text',
            value: `\u0001${highlightText}\u0002`,
            marked: true // 标记为需要转换
          });

          pos = end + 2;
        }

        // 替换原始节点
        if (children.length > 0) {
          Object.assign(node, {
            type: 'text',
            children: children,
            value: ''
          });
        }
      }

      // 递归访问子节点
      if (node.children && Array.isArray(node.children)) {
        node.children.forEach(visitor);
      }
    };

    visitor(tree);

    // 第二遍: 将标记的节点转换为 mark 元素
    const transformMarked = (node: any) => {
      if (node.children && Array.isArray(node.children)) {
        const newChildren: any[] = [];
        for (const child of node.children) {
          if (child.marked) {
            // 创建 <mark> 元素
            newChildren.push({
              type: 'element',
              tagName: 'mark',
              properties: {},
              children: [{ type: 'text', value: child.value }]
            });
          } else if (child.children) {
            // 递归处理
            transformMarked(child);
            newChildren.push(child);
          } else {
            newChildren.push(child);
          }
        }
        node.children = newChildren;
      }
    };

    transformMarked(tree);
  };
}

/**
 * EventMarkdown - 用于事件日志的 Markdown 渲染组件
 *
 * 支持:
 * - GitHub Flavored Markdown (GFM): 表格、任务列表、删除线等
 * - 软换行: 单行换行也能分段 (remark-breaks)
 * - LaTeX数学公式: $inline$ 和 $$block$$ (remark-math + rehype-katex)
 * - Obsidian高亮: ==highlight== (自定义 remarkHighlight 插件)
 * - 分界线: --- 和 ===
 *
 * 样式适配:
 * - 紧凑的气泡内样式
 * - 深色模式完整支持
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
          remarkMath,
          remarkHighlight
        ]}
        rehypePlugins={[rehypeKatex]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
