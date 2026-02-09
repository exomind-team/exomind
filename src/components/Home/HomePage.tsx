/**
 * HomePage - ExoMind 首页
 *
 * 展示应用介绍和使用指南（Markdown 渲染）
 */

import { Link } from '@tanstack/react-router';
import { ClipboardList, Mic, Settings, ChevronRight, BookOpen } from 'lucide-react';
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
          to="/voice-chat"
          className="flex items-center gap-4 p-4 rounded-lg border hover:bg-accent transition-colors"
        >
          <Mic className="w-8 h-8 text-primary" />
          <div className="flex-1">
            <h3 className="font-semibold">语音聊天</h3>
            <p className="text-sm text-muted-foreground">语音输入助手</p>
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
        <div className="p-6 prose prose-sm dark:prose-invert max-w-none
            prose-headings:font-semibold
            prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg
            prose-table:border prose-table:border-collapse prose-th:border prose-th:bg-muted prose-td:border
            prose-blockquote:border-l-4 prose-blockquote:border-primary prose-blockquote:bg-muted/30 prose-blockquote:rounded-r
            prose-code:bg-muted prose-code:rounded prose-code:px-1.5 prose-code:py-0.5
            prose-pre:bg-muted prose-pre:rounded-lg">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {guideContent}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
