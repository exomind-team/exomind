/**
 * HomePage - ExoMind 首页
 *
 * 展示应用介绍和使用指南（Markdown 渲染）
 */

import { Link } from '@tanstack/react-router';
import { ClipboardList, Settings, ChevronRight, BookOpen, Users } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import guideContent from '../../docs/user-guide.md?raw';

export function HomePage() {
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      {/* 标题区 */}
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold">ExoMind</h1>
        <p className="text-xl text-muted-foreground">
          生命成长助手 - 记录、思考、成长
        </p>
      </div>

      {/* 功能导航 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Link
          to="/eventlog"
          className="flex items-center gap-4 p-4 rounded-lg border hover:bg-accent transition-colors"
        >
          <ClipboardList className="w-8 h-8 text-primary" />
          <div className="flex-1">
            <h3 className="font-semibold">事件日志</h3>
            <p className="text-sm text-muted-foreground">记录你的想法</p>
          </div>
          <ChevronRight className="w-5 h-5 text-muted-foreground" />
        </Link>

        <Link
          to="/user-manage"
          className="flex items-center gap-4 p-4 rounded-lg border hover:bg-accent transition-colors"
        >
          <Users className="w-8 h-8 text-primary" />
          <div className="flex-1">
            <h3 className="font-semibold">用户管理</h3>
            <p className="text-sm text-muted-foreground">设备与账号联调入口</p>
          </div>
          <ChevronRight className="w-5 h-5 text-muted-foreground" />
        </Link>

        <Link
          to="/settings"
          className="flex items-center gap-4 p-4 rounded-lg border hover:bg-accent transition-colors"
        >
          <Settings className="w-8 h-8 text-primary" />
          <div className="flex-1">
            <h3 className="font-semibold">设置</h3>
            <p className="text-sm text-muted-foreground">配置你的偏好</p>
          </div>
          <ChevronRight className="w-5 h-5 text-muted-foreground" />
        </Link>
      </div>

      {/* 使用指南 */}
      <div className="border rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 p-4 bg-muted/50">
          <BookOpen className="w-5 h-5" />
          <h2 className="text-lg font-semibold">使用指南</h2>
        </div>
        <div className="p-6 prose prose-sm dark:prose-invert max-w-none leading-relaxed
            prose-headings:font-bold prose-headings:tracking-tight
            prose-h1:text-3xl prose-h1:border-b prose-h1:pb-3 prose-h1:mt-8 prose-h1:mb-5 prose-h1:text-foreground
            prose-h2:text-2xl prose-h2:border-b prose-h2:pb-2 prose-h2:mt-6 prose-h2:mb-4 prose-h2:text-foreground
            prose-h3:text-xl prose-h3:font-semibold prose-h3:mt-5 prose-h3:mb-3 prose-h3:text-foreground
            prose-h4:text-lg prose-h4:font-medium prose-h4:mt-4 prose-h4:mb-2 prose-h4:text-muted-foreground
            prose-p:my-2 prose-p:leading-7 prose-p:text-foreground/90
            prose-ul:space-y-2 prose-ul:my-3
            prose-ol:space-y-2 prose-ol:my-3
            prose-li:my-1 prose-li:leading-7
            prose-table:border prose-table:border-collapse prose-table:rounded-lg prose-table:overflow-hidden
            prose-th:bg-muted prose-th:font-semibold prose-th:text-foreground prose-th:py-3 prose-th:px-4 prose-th:border-b
            prose-td:py-3 prose-td:px-4 prose-td:border-b prose-td:first:rounded-l-lg prose-td:last:rounded-r-lg
            prose-tr:nth-child(even):bg-muted/30 prose-tr:last:rounded-b-lg
            prose-tr:hover:bg-muted/50 prose-tr:transition-colors
            prose-blockquote:border-l-4 prose-blockquote:border-primary prose-blockquote:bg-primary/5 prose-blockquote:py-2 prose-blockquote:px-4 prose-blockquote:not-italic prose-blockquote:rounded-r
            prose-code:bg-muted/80 prose-code:text-foreground prose-code:rounded prose-code:px-1.5 prose-code:py-0.5 prose-code:font-medium
            prose-code:before:content-none prose-code:after:content-none
            prose-pre:bg-muted/80 prose-pre:text-foreground prose-pre:rounded-lg prose-pre:p-4
            prose-hr:border-t-2 prose-hr:border-muted/50 prose-hr:my-6
            prose-a:text-primary prose-a:underline prose-a:underline-offset-4 hover:prose-a:text-primary/80">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {guideContent}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
