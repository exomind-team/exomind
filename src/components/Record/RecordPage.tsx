import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useTimeBlockStore, parseTimeBlockCommand, type TimeBlockEvent } from '@/lib/stores/timeblock-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Clock, Tag } from 'lucide-react';
import { VoiceMessageInput } from '@/components/VoiceMessageInput';

export function RecordPage() {
  const [inputValue, setInputValue] = useState('');
  const inputValueRef = useRef('');
  const [showHistory, setShowHistory] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // TimeBlock Store
  const {
    events,
    // timeBlocks, // TODO: 未来用于时间块管理
    activeBlock,
    addEvent,
    startBlock,
    endBlock,
    getEventsInBlock,
    getTimeBlocksByStartTime,
    load: loadTimeBlocks,
    save: saveTimeBlocks,
  } = useTimeBlockStore();

  // ============================================================================
// TODO: 后续添加标签 Badge 显示功能
// - 在每条记录下方显示解析出的标签
// - 支持点击筛选相同标签的记录
// ============================================================================
  const parseTags = (content: string): { text: string; tags: string[] } => {
    const tagRegex = /#(\S+)/g;
    const tags: string[] = [];
    const text = content.replace(tagRegex, (_match, tag) => {
      tags.push(tag);
      return '';
    }).trim();
    return { text, tags };
  };

  // 按日期分组事件
  const groupedEvents = useMemo(() => {
    const groups = new Map<string, TimeBlockEvent[]>();

    for (const event of events) {
      const date = new Date(event.timestamp).toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
      });

      if (!groups.has(date)) {
        groups.set(date, []);
      }
      groups.get(date)!.push(event);
    }

    return groups;
  }, [events]);

  // 滚动到底部
  const scrollToBottom = () => {
    listRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    loadTimeBlocks();
  }, [loadTimeBlocks]);

  useEffect(() => {
    scrollToBottom();
  }, [events]);

  // 处理输入
  const handleSubmit = useCallback(async () => {
    const trimmed = inputValueRef.current.trim();
    if (!trimmed) return;

    // 解析命令
    const command = parseTimeBlockCommand(trimmed);
    const { text, tags } = parseTags(trimmed);

    if (command.type === 'start' && command.name) {
      // 开始时间块
      startBlock(command.name);
      await saveTimeBlocks();
    } else if (command.type === 'end') {
      // 结束时间块
      const block = endBlock();
      if (block) {
        await saveTimeBlocks();
      }
    } else if (text) {
      // 普通记录
      addEvent(text, tags);
      await saveTimeBlocks();
    }

    setInputValue('');
    inputValueRef.current = '';
  }, [startBlock, endBlock, addEvent, saveTimeBlocks]);

  // 语音识别结果回调 - 更新输入值
  const handleVoiceResult = useCallback((text: string) => {
    const newValue = inputValueRef.current.trim()
      ? `${inputValueRef.current} ${text}`
      : text;
    setInputValue(newValue);
    inputValueRef.current = newValue;
  }, []);

  // ============================================================================
// TODO: 后续预定义标签集合
// - 支持预定义标签类型
// - 标签自动补全
// ============================================================================
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleTimeString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // 获取活跃时间块信息
  const activeBlockInfo = useMemo(() => {
    if (!activeBlock) return null;
    const startEvent = events.find((e) => e.id === activeBlock.startId);
    if (!startEvent) return null;

    const duration = Date.now() - startEvent.timestamp;
    const minutes = Math.floor(duration / 60000);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    return {
      name: activeBlock.name,
      duration: hours > 0 ? `${hours}小时${remainingMinutes}分钟` : `${minutes}分钟`,
      isLong: duration > 4 * 60 * 60 * 1000,
    };
  }, [activeBlock, events]);

  // 获取最近时间块历史
  const recentBlocks = useMemo(() => {
    return getTimeBlocksByStartTime().slice(-10).reverse();
  }, [getTimeBlocksByStartTime]);

  const hasNoEvents = events.length === 0;

  // 获取内容中的标签
  const getContentTags = (content: string): string[] => {
    const matches = content.match(/#(\S+)/g);
    return matches ? matches.map(t => t.slice(1)) : [];
  };

  return (
    <div className="flex flex-col h-full max-h-[100dvh] lg:max-h-screen" data-testid="record-page">
      {/* 头部 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b gap-2 shrink-0" data-testid="record-header">
        <div className="flex items-center gap-2">
          <h2 className="text-lg sm:text-2xl font-bold" data-testid="record-title">记录</h2>
          <p className="text-xs sm:text-sm text-muted-foreground" data-testid="record-status">
            {activeBlockInfo ? (
              <span className="flex items-center gap-2">
                <Clock size={12} className="text-blue-500" />
                记录中: {activeBlockInfo.name}
              </span>
            ) : (
              <span>随时记录</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeBlockInfo && (
            <Badge variant="default" className="flex items-center gap-1 text-xs">
              <Clock size={12} />
              <span className={activeBlockInfo.isLong ? "text-red-300" : ""}>
                {activeBlockInfo.duration}
              </span>
            </Badge>
          )}
          <Button
            variant={showHistory ? "default" : "outline"}
            size="sm"
            onClick={() => setShowHistory(!showHistory)}
            className="text-xs"
            data-testid="history-toggle"
          >
            <Clock size={14} className="mr-1" />
            历史
          </Button>
        </div>
      </div>

      {/* 事件列表 */}
      <div
        className="flex-1 overflow-auto p-3 sm:p-6"
        ref={listRef as React.RefObject<HTMLDivElement>}
        data-testid="event-list"
      >
        {hasNoEvents ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-muted flex items-center justify-center mb-3 sm:mb-4">
              <span className="text-2xl sm:text-3xl">📝</span>
            </div>
            <p className="text-base sm:text-lg font-medium mb-1">暂无记录</p>
            <p className="text-xs sm:text-sm text-muted-foreground">
              输入内容开始记录<br />
              <code className="text-xs bg-muted px-1 rounded">开始xxx</code> 开始时间块，<code className="text-xs bg-muted px-1 rounded">结束</code>
            </p>
          </div>
        ) : (
          <div className="space-y-4 sm:space-y-6">
            {Array.from(groupedEvents.entries()).map(([date, dateEvents]) => (
              <div key={date}>
                <div className="flex items-center justify-center mb-3 sm:mb-4">
                  <span className="text-xs text-muted-foreground bg-muted px-2 sm:px-3 py-1 rounded-full">
                    {date}
                  </span>
                </div>
                <div className="space-y-2 sm:space-y-3">
                  {dateEvents.map((event) => {
                    const isBlockStart = event._tags.includes('block_start');
                    const isBlockEnd = event._tags.includes('block_end');
                    const isTimeBlock = isBlockStart || isBlockEnd;
                    const contentTags = getContentTags(event._content);

                    return (
                      <div
                        key={event.id}
                        className={`flex gap-2 sm:gap-3 ${isTimeBlock ? 'justify-center' : ''}`}
                      >
                        {!isTimeBlock && (
                          <Avatar className="h-6 w-6 sm:h-8 sm:w-8 shrink-0">
                            <AvatarFallback className={isTimeBlock
                              ? (isBlockStart ? "bg-blue-500 text-white" : "bg-red-500 text-white")
                              : "bg-primary text-primary-foreground"
                            }>
                              记
                            </AvatarFallback>
                          </Avatar>
                        )}
                        <div className={isTimeBlock ? '' : 'max-w-[75%] sm:max-w-[70%]'}>
                          <div
                            className={`inline-block px-3 py-1.5 sm:px-4 sm:py-2 rounded-2xl ${
                              isTimeBlock
                                ? (isBlockStart
                                    ? "bg-blue-100 text-blue-800 rounded-br-md"
                                    : "bg-red-100 text-red-800 rounded-br-md")
                                : "bg-primary text-primary-foreground rounded-br-md"
                            }`}
                          >
                            {isTimeBlock && (
                              <span className="text-xs opacity-75 mr-1">
                                {isBlockStart ? '🔷' : '🔴'}
                              </span>
                            )}
                            <p className="text-xs sm:text-sm break-words">
                              {event._content.replace(/#\S+/g, '').trim()}
                            </p>
                            {contentTags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {contentTags.map((tag) => (
                                  <Badge key={tag} variant="secondary" className="text-[10px] px-1 py-0">
                                    <Tag size={10} className="mr-0.5" />
                                    {tag}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                          {!isTimeBlock && (
                            <p className="text-xs text-muted-foreground mt-0.5 sm:mt-1">
                              {formatTime(event.timestamp)}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        <div ref={listRef} />
      </div>

      {/* 历史面板 */}
      {showHistory && (
        <div className="border-t bg-muted/30 p-3 sm:p-4 max-h-[40vh] sm:max-h-[50vh] overflow-auto" data-testid="history-panel">
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Clock size={16} />
            时间块历史
          </h3>
          {recentBlocks.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无记录</p>
          ) : (
            <div className="space-y-2">
              {recentBlocks.map((block) => {
                const startEvent = events.find((e) => e.id === block.startId);
                const blockEvents = getEventsInBlock(block);

                return (
                  <Card key={block.id} className="bg-background" data-testid={`history-block-${block.id}`}>
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm flex items-center gap-1">
                          {block.endId ? '🔴' : '🔵'} {block.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {startEvent && formatTime(startEvent.timestamp)}
                        </span>
                      </div>
                      {block._note && (
                        <p className="text-xs text-muted-foreground mb-1">📝 {block._note}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {blockEvents.length} 条记录
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 输入区域 */}
      <div className="px-3 sm:px-6 py-3 border-t bg-card shrink-0 safe-area-pb">
        <VoiceMessageInput
          onSend={handleSubmit}
          onVoiceResult={handleVoiceResult}
          placeholder={
            activeBlock
              ? `记录中: ${activeBlock.name}...`
              : "输入记录... ('开始xxx' 开始时间块)"
          }
          buttonSize={40}
        />
        {inputValue.trim() && (
          <p className="text-xs text-muted-foreground mt-1">
            {parseTags(inputValue).tags.length > 0 && (
              <span className="flex items-center gap-1">
                <Tag size={12} />
                标签: {parseTags(inputValue).tags.map(t => `#${t}`).join(' ')}
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
