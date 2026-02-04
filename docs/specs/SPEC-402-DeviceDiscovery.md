# SPEC-402: 设备发现与配对

## 概述
实现设备发现和配对机制，让移动端能发现并连接到桌面端

## 设计理由
- 用户不需要手动输入 IP 地址
- 需要安全确认，防止未授权连接

## 功能定义
1. 设备发现：mDNS 广播和扫描
2. 设备列表：展示可连接设备
3. 配对流程：确认码验证
4. 持久化：保存已配对设备

## 接口定义

### TypeScript 接口
```typescript
interface DiscoveredDevice {
  id: string;
  name: string;
  ip: string;
  port: number;
  type: 'desktop' | 'mobile';
}

interface PairedDevice extends DiscoveredDevice {
  pairedAt: number;
  confirmed: boolean;
}
```

## 验收标准
- [ ] 移动端能自动发现局域网内的桌面端
- [ ] 配对需要用户确认
- [ ] 已配对设备信息持久化存储
