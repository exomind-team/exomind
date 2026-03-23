import type { MeDashboardData } from '@/lib/types/me';

export const MOCK_ME_DASHBOARD_FIXTURE: MeDashboardData = {
  status: {
    summaryTitle: '当前状态',
    updatedAtLabel: '14:32',
    metrics: [
      { id: 'energy', title: '身能', value: '69', hint: '今日状态', tone: 'warm' },
      { id: 'mood', title: '情绪', value: '79', hint: '有弹性', tone: 'green' },
      { id: 'focus', title: '专注', value: '3.6h', hint: '深工时长', tone: 'blue' },
    ],
    financeMetrics: [
      { id: 'balance', title: '收支', value: '¥2,450', hint: '预算结余', tone: 'amber' },
      { id: 'budget', title: '今日预算', value: '¥200', hint: '可支配', tone: 'rose' },
      { id: 'burn-rate', title: '消耗速率', value: '¥3,280', hint: '本周累计', tone: 'green' },
    ],
    behaviorCompletionText: '完成率 92%',
    behaviorPatterns: [
      { id: 'business-read', title: '读 3 页商业书', streakText: '连续 7 天', state: 'good' },
      { id: 'knowledge-review', title: '知识卡片复盘', streakText: '1 天未习', state: 'warn' },
      { id: 'exercise', title: '30 分钟运动', streakText: '连续 12 天', state: 'good' },
      { id: 'relationship', title: '主动联系家人', streakText: '5 天未联', state: 'risk' },
    ],
    historyItems: [
      { id: 'h1', title: '阅读中断 5 天', detail: '因外出会议，复盘节奏被打乱', deltaText: '↑ 10%', deltaTone: 'up' },
      { id: 'h2', title: '运动恢复 2 次', detail: '晚饭后散步与力量训练恢复', deltaText: '→ 0', deltaTone: 'flat' },
      { id: 'h3', title: '社交投入 3 次', detail: '与家人视频沟通 + 线下聚会', deltaText: '↓ 25%', deltaTone: 'down' },
    ],
  },
  learn: {
    urgentItems: [
      {
        id: 'lk-rust',
        title: 'Rust 所有权机制',
        source: 'ExoMind 知识库条目',
        priorityText: '3 项',
        tone: 'warm',
      },
      {
        id: 'lk-ws',
        title: 'WebSocket 协议',
        source: '文档阅读点',
        priorityText: '2 项',
        tone: 'blue',
      },
      {
        id: 'lk-db',
        title: '向量数据库原理',
        source: 'Agent 进化系统',
        priorityText: '1 项',
        tone: 'purple',
      },
    ],
    lanes: [
      {
        id: 'lane-compile',
        title: '编译器',
        countText: '12 条',
        progressText: '6 / 10',
        tags: ['已对比 3', '在学 2', '待复习 1'],
      },
      {
        id: 'lane-philo',
        title: '哲学',
        countText: '2 / 5',
        progressText: '2 / 5',
        tags: ['已对比 1', '待学 3', '在学 1'],
      },
    ],
  },
  implicit: {
    beliefNodes: [
      { id: 'belief-output', label: '输出优先', x: 16, y: 32, emphasis: 'primary' },
      { id: 'belief-verify', label: '先验证', x: 116, y: 56, emphasis: 'secondary' },
      { id: 'belief-review', label: '高频复盘', x: 208, y: 34, emphasis: 'primary' },
      { id: 'belief-focus', label: '深工优先', x: 140, y: 106, emphasis: 'secondary' },
      { id: 'belief-system', label: '外脑化', x: 64, y: 124, emphasis: 'tertiary' },
    ],
    habitLoops: [
      {
        id: 'loop-review',
        name: '收到消息提醒',
        cue: '空闲时段触发',
        routine: '立刻阅读并复盘',
        reward: '当天收敛风险点',
        frequencyText: '日均 12 次',
        state: 'warn',
      },
      {
        id: 'loop-code',
        name: '收到热点',
        cue: '打开样例并试错',
        routine: '20 分钟实现最小验证',
        reward: '减少“想法悬空”',
        frequencyText: '日均 4 次',
        state: 'good',
      },
      {
        id: 'loop-walk',
        name: '遇到卡顿',
        cue: '先离开屏幕 5 分钟',
        routine: '散步 + 口述下一步',
        reward: '恢复注意力',
        frequencyText: '日均 6 次',
        state: 'good',
      },
    ],
  },
};

