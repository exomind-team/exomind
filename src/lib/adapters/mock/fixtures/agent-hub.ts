import type {
  AgentAddNodeOption,
  AgentConversationMessage,
  AgentDetailData,
  AgentDeviceGroup,
  AgentHubListSection,
  AgentHubTopologyData,
  AgentMarketCategory,
  AgentMarketItem,
} from '@/lib/types/agent-hub';

export interface AgentHubMockFixture {
  topology: AgentHubTopologyData;
  listSections: AgentHubListSection[];
  deviceGroups: AgentDeviceGroup[];
  addNodeOptions: AgentAddNodeOption[];
  agentDetails: Record<string, AgentDetailData>;
  actorDetails: Record<string, AgentDetailData>;
  marketCategories: AgentMarketCategory[];
  marketItems: AgentMarketItem[];
  conversations: Record<string, AgentConversationMessage[]>;
}

export const AGENT_HUB_MOCK_FIXTURE: AgentHubMockFixture = {
  topology: {
    nodes: [
      { id: 'output-telegram', type: 'output', name: 'Telegram', status: 'running', layer: 'top', brandColor: '#2AABEE' },
      { id: 'output-wechat', type: 'output', name: '微信', status: 'running', layer: 'top', brandColor: '#07C160' },
      { id: 'output-email', type: 'output', name: '邮件', status: 'idle', layer: 'top', brandColor: '#EA580C' },
      { id: 'output-feishu', type: 'output', name: '飞书', status: 'idle', layer: 'top', brandColor: '#3370FF' },
      { id: 'agent-daily', type: 'agent', name: '日报 Agent', status: 'running', layer: 'middle', brandColor: '#C75B3A', subtitle: '运行中' },
      { id: 'agent-summary', type: 'agent', name: '摘要 Agent', status: 'idle', layer: 'middle', brandColor: '#3B82F6', subtitle: '待机中' },
      { id: 'actor-timer', type: 'actor', name: '定时唤醒', status: 'running', layer: 'middle', brandColor: '#78716C', subtitle: '22:00 daily' },
      { id: 'actor-cleaner', type: 'actor', name: '数据清洗', status: 'idle', layer: 'middle', brandColor: '#78716C', subtitle: 'manual' },
      { id: 'input-rss', type: 'input', name: 'RSS', status: 'running', layer: 'bottom', brandColor: '#F97316' },
      { id: 'input-wechat', type: 'input', name: '微信群聊', status: 'running', layer: 'bottom', brandColor: '#07C160' },
      { id: 'input-api', type: 'input', name: 'API', status: 'idle', layer: 'bottom', brandColor: '#8B5CF6' },
      { id: 'input-cron', type: 'input', name: '定时触发', status: 'running', layer: 'bottom', brandColor: '#0EA5E9' },
    ],
    edges: [
      { id: 'e-rss-daily', fromNodeId: 'input-rss', toNodeId: 'agent-daily', color: '#C75B3A90' },
      { id: 'e-wechat-daily', fromNodeId: 'input-wechat', toNodeId: 'agent-daily', color: '#C75B3A90' },
      { id: 'e-wechat-summary', fromNodeId: 'input-wechat', toNodeId: 'agent-summary', color: '#3B82F690' },
      { id: 'e-api-summary', fromNodeId: 'input-api', toNodeId: 'agent-summary', color: '#3B82F690' },
      { id: 'e-cron-timer', fromNodeId: 'input-cron', toNodeId: 'actor-timer', color: '#78716C90' },
      { id: 'e-timer-daily', fromNodeId: 'actor-timer', toNodeId: 'agent-daily', color: '#78716C90' },
      { id: 'e-daily-telegram', fromNodeId: 'agent-daily', toNodeId: 'output-telegram', color: '#2AABEE90' },
      { id: 'e-daily-wechat', fromNodeId: 'agent-daily', toNodeId: 'output-wechat', color: '#07C16090' },
      { id: 'e-summary-email', fromNodeId: 'agent-summary', toNodeId: 'output-email', color: '#EA580C90' },
      { id: 'e-summary-feishu', fromNodeId: 'agent-summary', toNodeId: 'output-feishu', color: '#3370FF90' },
    ],
    selectedNodeId: null,
  },
  listSections: [
    {
      id: 'section-input',
      title: '信号输入',
      count: 4,
      items: [
        { id: 'input-rss', type: 'input', name: 'RSS', description: '订阅源输入', status: 'running', icon: 'rss' },
        { id: 'input-wechat', type: 'input', name: '微信群聊', description: '微信群消息输入', status: 'running', icon: 'message-circle' },
        { id: 'input-api', type: 'input', name: 'API', description: 'Webhook 输入', status: 'idle', icon: 'webhook' },
        { id: 'input-cron', type: 'input', name: '定时触发', description: 'Cron 时间触发', status: 'running', icon: 'timer' },
      ],
    },
    {
      id: 'section-agent',
      title: 'Agent',
      count: 2,
      items: [
        { id: 'agent-daily', type: 'agent', name: '日报 Agent', description: '运行中 · 2 入 2 出', status: 'running', icon: 'brain', badgeText: '2 入 / 2 出' },
        { id: 'agent-summary', type: 'agent', name: '摘要 Agent', description: '待机中 · 2 入 2 出', status: 'idle', icon: 'sparkles', badgeText: '2 入 / 2 出' },
      ],
    },
    {
      id: 'section-actor',
      title: 'Actor',
      count: 2,
      items: [
        { id: 'actor-timer', type: 'actor', name: '定时唤醒', description: '每天 22:00', status: 'running', icon: 'timer' },
        { id: 'actor-cleaner', type: 'actor', name: '数据清洗', description: '手动触发', status: 'idle', icon: 'funnel' },
      ],
    },
    {
      id: 'section-output',
      title: '输出节点',
      count: 4,
      items: [
        { id: 'output-telegram', type: 'output', name: 'Telegram', description: '通知频道', status: 'running', icon: 'send' },
        { id: 'output-wechat', type: 'output', name: '微信', description: '企业微信推送', status: 'running', icon: 'message-circle' },
        { id: 'output-email', type: 'output', name: '邮件', description: 'SMTP 输出', status: 'idle', icon: 'mail' },
        { id: 'output-feishu', type: 'output', name: '飞书', description: '飞书机器人输出', status: 'idle', icon: 'bird' },
      ],
    },
  ],
  deviceGroups: [
    {
      id: 'group-local',
      title: '本地设备',
      summary: '3 台 · 全部在线',
      cards: [
        {
          id: 'device-desktop',
          name: '主力台式机',
          type: 'desktop',
          status: 'online',
          summary: '在线 · 4 节点运行中',
          metrics: [
            { label: 'CPU', value: '42%' },
            { label: 'MEM', value: '58%' },
            { label: 'Latency', value: '6ms' },
          ],
          tags: [
            { id: 'tag-daily', label: '日报Agent', color: '#C75B3A' },
            { id: 'tag-summary', label: '摘要Agent', color: '#3B82F6' },
            { id: 'tag-monitor', label: '监控Agent', color: '#22C55E' },
          ],
          isHost: true,
        },
        {
          id: 'device-laptop',
          name: '移动笔记本',
          type: 'laptop',
          status: 'online',
          summary: '在线 · 1 节点运行中',
          metrics: [{ label: 'Battery', value: '71%' }],
          tags: [{ id: 'tag-sync', label: 'Obsidian 同步', color: '#8B5CF6' }],
        },
        {
          id: 'device-phone',
          name: 'Android 手机',
          type: 'phone',
          status: 'online',
          summary: '在线 · 2 节点运行中',
          metrics: [{ label: 'Signal', value: '5G' }],
          tags: [
            { id: 'tag-wx', label: '微信输入', color: '#07C160' },
            { id: 'tag-notify', label: '通知输出', color: '#2AABEE' },
          ],
        },
      ],
    },
    {
      id: 'group-cloud',
      title: '云服务器',
      summary: '1 台 · 在线',
      cards: [
        {
          id: 'device-hk-vps',
          name: '香港 VPS',
          type: 'server',
          status: 'online',
          summary: '在线 · 2 节点 · 3 容器',
          metrics: [
            { label: 'CPU', value: '35%' },
            { label: 'MEM', value: '49%' },
          ],
          tags: [
            { id: 'tag-n8n', label: 'n8n', color: '#0EA5E9' },
            { id: 'tag-postgres', label: 'postgres', color: '#6366F1' },
            { id: 'tag-redis', label: 'redis', color: '#EC4899' },
          ],
        },
      ],
    },
  ],
  addNodeOptions: [
    { id: 'input', title: '添加信号输入', description: '新增 RSS / API / 传感器输入', icon: 'rss', tintColor: '#F97316' },
    { id: 'agent', title: '添加 Agent', description: '基于大模型的智能决策节点', icon: 'brain', tintColor: '#C75B3A' },
    { id: 'actor', title: '添加 Actor', description: '定时、条件触发的程序执行节点', icon: 'timer', tintColor: '#78716C' },
    { id: 'output', title: '添加输出节点', description: '消息通知、写库、API 回调等输出', icon: 'send', tintColor: '#2AABEE' },
    { id: 'market', title: '从市场安装', description: '浏览社区插件并一键接入节点', icon: 'shopping-bag', tintColor: '#8B5CF6' },
  ],
  agentDetails: {
    'agent-daily': {
      id: 'agent-daily',
      type: 'agent',
      title: '日报 Agent',
      status: 'running',
      description: '每天收集输入通道信息并生成日报，支持晚间复盘。',
      icon: 'newspaper',
      tintColor: '#C75B3A',
      stats: [
        { label: '已执行', value: '421' },
        { label: '成功率', value: '97.2%' },
        { label: '输出节点', value: '2' },
      ],
      triggerRules: [
        { key: '触发方式', value: '定时 + 手动' },
        { key: 'Cron', value: '0 22 * * *', highlight: true },
        { key: '时区', value: 'Asia/Shanghai' },
        { key: '下次执行', value: '2026-02-23 22:00' },
      ],
      targets: [
        { id: 'output-telegram', type: 'output', name: 'Telegram', description: '日报通知', status: 'running', icon: 'send' },
        { id: 'output-wechat', type: 'output', name: '微信', description: '日报推送', status: 'running', icon: 'message-circle' },
      ],
      recentLogs: [
        { id: 'log-1', time: '21:58', title: '收集 RSS 12 条', status: 'running', duration: '1.2s' },
        { id: 'log-2', time: '21:59', title: '聚合微信群聊 5 条', status: 'running', duration: '0.9s' },
        { id: 'log-3', time: '22:00', title: '输出日报到 Telegram', status: 'running', duration: '0.5s' },
      ],
    },
  },
  actorDetails: {
    'actor-timer': {
      id: 'actor-timer',
      type: 'actor',
      title: '定时唤醒',
      status: 'running',
      description: '每天定时触发日报 Agent 自动执行。',
      icon: 'timer',
      tintColor: '#78716C',
      stats: [
        { label: '已触发', value: '896' },
        { label: '准时率', value: '99.8%' },
        { label: '下游节点', value: '1' },
      ],
      triggerRules: [
        { key: '触发方式', value: 'Cron' },
        { key: 'Cron', value: '0 22 * * *', highlight: true },
        { key: '时区', value: 'Asia/Shanghai' },
        { key: '下次执行', value: '2026-02-23 22:00' },
      ],
      targets: [
        { id: 'agent-daily', type: 'agent', name: '日报 Agent', description: '当前目标', status: 'running', icon: 'brain' },
      ],
      recentLogs: [
        { id: 'log-actor-1', time: '22:00', title: '触发日报 Agent', status: 'running', duration: '45ms' },
        { id: 'log-actor-2', time: '21:00', title: '跳过（维护窗口）', status: 'warning', duration: '15ms' },
        { id: 'log-actor-3', time: '20:00', title: '触发成功', status: 'running', duration: '48ms' },
      ],
    },
  },
  marketCategories: [
    { id: 'all', label: '全部' },
    { id: 'agent', label: 'Agent' },
    { id: 'source', label: '数据源' },
    { id: 'knowledge', label: '知识包' },
    { id: 'output', label: '输出' },
  ],
  marketItems: [
    {
      id: 'market-code-review-agent',
      name: 'Code Review Agent',
      summary: '自动审查代码变更并生成风险建议，支持 GitHub PR 触发。',
      icon: 'shield-check',
      tintColor: '#3B82F6',
      tags: ['agent', 'github', 'security'],
      installsText: '1.2k installs',
      ratingText: '4.9',
    },
    {
      id: 'market-google-calendar-source',
      name: 'Google Calendar 数据源',
      summary: '同步日历事件作为信号输入，用于会议准备与时间分析。',
      icon: 'calendar-days',
      tintColor: '#EA580C',
      tags: ['source', 'calendar', 'schedule'],
      installsText: '860 installs',
      ratingText: '4.8',
    },
    {
      id: 'market-team-knowledge-pack',
      name: '团队知识库',
      summary: '共享代码规范与项目上下文，支持团队协作节点复用。',
      icon: 'book-open-text',
      tintColor: '#22C55E',
      tags: ['knowledge', 'team', 'docs'],
      installsText: '530 installs',
      ratingText: '4.7',
    },
  ],
  conversations: {
    'agent-daily': [
      {
        id: 'msg-agent-welcome',
        role: 'agent',
        content: '你好！我是日报 Agent。有什么需要我整理的吗？',
        createdAt: '2026-02-23T09:41:00.000Z',
      },
      {
        id: 'msg-user-1',
        role: 'user',
        content: '帮我看看今天收集了哪些信息？',
        createdAt: '2026-02-23T09:41:30.000Z',
      },
    ],
  },
};

