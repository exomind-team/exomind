/**
 * HomePage - ExoMind 首页
 *
 * 展示应用介绍和使用指南（Markdown 渲染）
 */

import { useState, useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import { ClipboardList, Mic, Settings, ChevronRight, ChevronDown, ChevronUp, BookOpen } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import guideContent from '../../docs/user-guide.md?raw';

export function HomePage() {
  const [showGuide, setShowGuide] = useState(false);
  const [markdownContent, setMarkdownContent] = useState('');

  // 加载 Markdown 内容
  useEffect(() => {
    setMarkdownContent(guideContent);
  }, []);

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

      {/* 使用指南 - 可折叠区域 */}
      <div className="border rounded-lg overflow-hidden">
        <button
          onClick={() => setShowGuide(!showGuide)}
          className="w-full flex items-center justify-between p-4 bg-muted/50 hover:bg-muted transition-colors"
        >
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5" />
            <h2 className="text-lg font-semibold">使用指南</h2>
          </div>
          {showGuide ? (
            <ChevronUp className="w-5 h-5" />
          ) : (
            <ChevronDown className="w-5 h-5" />
          )}
        </button>

        {showGuide && (
          <div className="p-6 prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{markdownContent}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
