# SPEC-403: 数据同步协议

## 概述
定义多端数据同步的消息协议和冲突解决策略

## 设计理由
- 需要可靠的数据同步机制
- 需要处理离线场景和冲突

## 消息类型
1. AUTH: 认证
2. SYNC_REQUEST: 同步请求
3. SYNC_RESPONSE: 同步响应
4. CHANGE: 数据变更
5. ACK: 确认

## 消息格式
```typescript
interface SyncMessage {
  type: 'AUTH' | 'SYNC_REQUEST' | 'SYNC_RESPONSE' | 'CHANGE' | 'ACK';
  payload: unknown;
  timestamp: number;
  deviceId: string;
}
```

## 冲突解决
使用 Last-Write-Wins (简化版)
- 时间戳比较
- 设备 ID 作为平局决胜

## 验收标准
- [ ] 消息序列化/反序列化正确
- [ ] 冲突解决逻辑正确
- [ ] 离线队列能正确重放
