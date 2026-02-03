# Round04-20260129-WebUI-WithSidebar

> 轮次记忆：exomind 网页开发 - 侧边栏 + 主页
> 日期：2026-01-29
> 状态：已完成

---

## 任务目标

按照新的项目架构，开发 exomind 网页服务，包含：
- 主页（资源状态展示 + 快捷入口）
- 侧边栏菜单（主页、资源、对话、任务、财务）

---

## 完成内容

### 前端组件

| 文件 | 说明 |
|------|------|
| `src/ui/src/App.tsx` | 主应用组件，实现页面路由切换 |
| `src/ui/src/App.css` | 主应用布局样式（侧边栏 + 主内容区） |
| `src/ui/src/components/Sidebar.tsx` | 侧边栏组件 |
| `src/ui/src/components/Sidebar.css` | 侧边栏样式 |
| `src/ui/src/pages/HomePage.tsx` | 主页组件 |
| `src/ui/src/pages/HomePage.css` | 主页样式 |

### 功能特性

1. **侧边栏导航**
   - 5个导航项：主页、资源、对话、任务、财务
   - 选中状态高亮显示
   - 固定左侧，响应式布局

2. **主页展示**
   - MiniMax 额度进度条
   - VPS 资源监控（CPU/内存/磁盘）
   - 4个快捷操作卡片

3. **API 集成**
   - `/api/resource/usage` - 资源使用率
   - `/api/resource/vps` - VPS 状态

---

## 技术决策

### 1. 组件结构

```
src/ui/src/
├── App.tsx          # 主入口，页面路由
├── App.css          # 全局布局
├── components/
│   ├── Sidebar.tsx  # 侧边栏
│   └── Sidebar.css
└── pages/
    ├── HomePage.tsx # 主页
    └── HomePage.css
```

### 2. 路由方式

使用 React `useState` 实现客户端路由：
```tsx
const [currentPage, setCurrentPage] = useState<Page>('home');
```

### 3. 样式方案

- CSS Modules 风格（按组件分文件）
- 暗色主题：#1a1a2e → #16213e 渐变
- 强调色：#64ffda（青色）

---

## 验证结果

| 验证项 | 结果 |
|--------|------|
| 后端服务 (1949) | ✅ 健康检查正常 |
| 前端服务 (1921) | ✅ 页面正常渲染 |
| API 数据 | ✅ 资源数据正确显示 |
| 页面布局 | ✅ 侧边栏 + 主页正常显示 |

---

## 经验总结

1. **Vite 代理配置**：正确配置 `/api` 代理到后端
2. **组件拆分**：按功能拆分 Sidebar 和 HomePage，代码更清晰
3. **样式隔离**：使用 CSS 文件隔离组件样式，避免冲突

---

## 下一步

1. 完善各子页面（资源、对话、任务、财务）
2. 添加响应式设计（移动端适配）
3. 集成真实 API 数据（MiniMax 额度、VPS 监控）

---

*创建时间：2026-01-29*
*版本：v1.0*
