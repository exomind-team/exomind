# SPEC-020 对话视图实现

> 版本：v1.0
> 创建时间：2026-01-29
> 优先级：P1

---

## 1. 用户需求

### 1.1 需求描述

用户需要一个现代化的网页对话界面，支持：
- 实时聊天（文本消息）
- 语音输入（调用 Voice-ime API 1921）
- 语音输出（TTS 语音合成）
- 历史消息展示
- 会话管理

### 1.2 用户场景

```
用户打开浏览器 → 看到对话界面 → 输入文字/语音 → 发送消息 → 收到回复
```

---

## 2. 输入

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| message | string | 是 | 用户消息内容 |
| audio | Blob | 否 | 语音输入（base64） |
| stream | boolean | 否 | 是否流式输出 |

---

## 3. 输出

### 3.1 对话消息格式

```typescript
interface ChatMessage {
  id: string;           // 消息 ID
  role: 'user' | 'assistant';  // 角色
  content: string;      // 消息内容
  audioUrl?: string;    // 语音回复 URL
  timestamp: string;    // 时间戳
  status: 'sending' | 'sent' | 'error';  // 状态
}
```

### 3.2 API 响应格式

```typescript
// 发送消息
POST /api/chat/send
{
  "success": true,
  "message": {
    "id": "msg_123",
    "content": "你好，我是小荷！",
    "audioUrl": "/api/audio/output_123.mp3",
    "timestamp": "2026-01-29T15:30:00Z"
  }
}

// 获取历史
GET /api/chat/history?limit=50
{
  "success": true,
  "messages": [...],
  "total": 100
}
```

---

## 4. 验收标准

- [ ] 对话界面可以发送和接收文本消息
- [ ] 支持语音输入（录制 → 发送到 1921 API）
- [ ] 支持语音输出（TTS 播放）
- [ ] 历史消息持久化存储
- [ ] 消息实时更新（WebSocket 或轮询）
- [ ] 响应式布局，支持移动端

---

## 5. 边界条件

| 条件 | 处理方式 |
|------|----------|
| 语音录制为空 | 提示用户重新录制 |
| 1921 API 不可用 | 回退到文本模式 |
| 消息过长 | 分片发送或拒绝 |
| 网络断开 | 显示离线状态，重连后恢复 |

---

## 6. 架构设计

### 6.1 前端架构

```
src/
├── dashboard.ts        # 现有仪表盘（修改）
├── chat/               # 对话视图模块 ⭐
│   ├── index.ts        # 模块入口
│   ├── ui.ts           # 对话 UI 组件
│   ├── store.ts        # 消息状态管理
│   └── types.ts        # 类型定义
```

### 6.2 后端架构

```
api-server.ts
├── POST /api/chat/send           # 发送消息
├── GET  /api/chat/history        # 获取历史
├── POST /api/chat/clear          # 清空对话
└── WebSocket /ws/chat            # 实时推送
```

### 6.3 Voice-ime 集成

```
对话视图 → /api/voice/recognize (POST) → Voice-ime (1921)
                                      ↓
                              返回识别结果
```

---

## 7. 技术实现

### 7.1 前端组件

```typescript
// 对话视图组件结构
class ChatView {
  private messages: ChatMessage[] = [];
  private isRecording: boolean = false;

  // 渲染对话区域
  renderMessages(): void;

  // 发送文本消息
  async sendMessage(content: string): Promise<void>;

  // 开始语音录制
  startRecording(): void;

  // 结束语音录制
  async stopRecording(): Promise<void>;

  // 播放语音回复
  playAudio(url: string): void;
}
```

### 7.2 API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/chat/send` | POST | 发送消息 |
| `/api/chat/history` | GET | 获取历史消息 |
| `/api/chat/clear` | POST | 清空对话 |
| `/api/voice/recognize` | POST | 语音识别（调用 1921） |
| `/ws/chat` | WebSocket | 实时消息推送 |

---

## 8. 测试用例

| 用例 | 预期结果 |
|------|----------|
| 发送文本消息 | 消息显示在对话中 |
| 发送空消息 | 显示错误提示 |
| 语音输入录制 | 显示录制状态 |
| 录制过短音频 | 提示重新录制 |
| 获取历史消息 | 返回最近 N 条 |
| 清空对话 | 所有消息被清除 |

---

## 9. 依赖项

| 依赖 | 用途 |
|------|------|
| Voice-ime API (1921) | 语音识别/合成 |
| MediaRecorder API | 浏览器录音 |
| Web Audio API | 音频播放 |

---

## 10. 任务分解

| 步骤 | 内容 | 状态 |
|------|------|------|
| 1 | 编写 SPEC 文档 | ⏳ |
| 2 | 创建 chat 模块目录 | ⏳ |
| 3 | 实现对话 UI 组件 | ⏳ |
| 4 | 实现消息状态管理 | ⏳ |
| 5 | 添加 API 端点 | ⏳ |
| 6 | 集成语音 API (1921) | ⏳ |
| 7 | 编写单元测试 | ⏳ |
| 8 | 运行测试验证 | ⏳ |
| 9 | 更新文档 | ⏳ |
| 10 | Git 提交 | ⏳ |

---

*文档创建：2026-01-29*
