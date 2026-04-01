# 图标 SVG 矢量化计划

> **Issue**: #795
> **Parent**: #708 (UI/UX 统一设计)
> **For Codex**: 本计划给 Codex 执行，不涉及架构决策

---

## 目标

把当前 `src-tauri/icons/icon.png` 的粉色心形小人图标重绘为 SVG，背景透明，然后用 Tauri CLI 生成全平台图标。

## 当前图标描述

当前图标是一个 **粉色/珊瑚色的心形小人**：
- 上方：一颗 3D 光泽感的心形（渐变从粉红到珊瑚色）
- 下方：两条弯曲的手臂/身体线条，从心形底部向外展开，像一个人举起双手
- 左侧线条偏粉红，右侧线条偏橙色
- 整体风格：柔和、圆润、有光泽感
- 背景：白色不透明（需改为透明）

## 任务步骤

### Step 1: 创建 SVG 文件

**创建**: `src-tauri/icons/icon.svg`

SVG 要求：
- **viewBox**: `0 0 512 512`（标准图标尺寸）
- **背景**: 透明（无 `<rect>` 填充背景）
- **心形**: 使用 `<path>` 绘制，填充用线性渐变（从 `#F472B6` 粉红到 `#FB923C` 珊瑚橙）
- **光泽效果**: 可用半透明白色椭圆模拟高光，或用径向渐变
- **身体/手臂线条**: 两条贝塞尔曲线 `<path>`，左侧用粉红色（`#F472B6`），右侧用橙色（`#FB923C`），线宽约 24-32px，`stroke-linecap: round`
- **整体比例**: 心形占上方约 60%，手臂线条占下方约 40%
- **文件大小**: < 50KB，纯矢量路径，不嵌入位图

视觉参考：读取 `src-tauri/icons/icon.png`（512x512 PNG）对照。

颜色提取参考（从 PNG 采样）：

| 部位 | 颜色范围 |
|------|---------|
| 心形亮部 | `#F9A8D4` → `#F472B6` |
| 心形暗部 | `#EC4899` → `#E11D48` |
| 心形高光 | `#FFFFFF` 半透明 |
| 左臂 | `#F472B6` → `#EC4899` |
| 右臂 | `#FB923C` → `#F97316` |

### Step 2: 视觉验证

在浏览器中打开 SVG，与原 PNG 对比：
- 形状轮廓一致
- 颜色风格一致（允许从 3D 光泽简化为扁平渐变，但要保持粉红+珊瑚的配色）
- 深色背景下无白块

### Step 3: 生成全平台图标

```bash
# 先安装 tauri-cli（如果没有）
cargo install tauri-cli

# 从 SVG 生成全平台图标
cd src-tauri
cargo tauri icon icons/icon.svg
```

这会自动生成：
- `icons/icon.ico` (Windows)
- `icons/icon.icns` (macOS)
- `icons/icon.png` (512x512)
- `icons/32x32.png`, `icons/64x64.png`, `icons/128x128.png`, `icons/128x128@2x.png`
- `icons/Square*.png` (Windows Store)
- `icons/StoreLogo.png`
- `icons/android/mipmap-*/ic_launcher*.png`
- `icons/ios/AppIcon-*.png`

### Step 4: 验证生成结果

```bash
# 检查关键文件已更新
ls -la src-tauri/icons/icon.svg
ls -la src-tauri/icons/icon.png
ls -la src-tauri/icons/icon.ico
ls -la src-tauri/icons/32x32.png

# 检查 Android adaptive icon 前景已更新
ls -la src-tauri/icons/android/mipmap-xxxhdpi/ic_launcher_foreground.png
```

### Step 5: 构建验证（可选）

```bash
# TypeScript 检查
npx tsc --noEmit

# 快速构建验证
bun build
```

## 验收标准

- [ ] `src-tauri/icons/icon.svg` 存在且 < 50KB
- [ ] SVG 在浏览器中打开，视觉与原 PNG 一致（粉色心形小人）
- [ ] SVG 背景透明（深色背景下无白块）
- [ ] `cargo tauri icon` 成功生成所有平台图标
- [ ] 生成的 `icon.png` (512x512) 背景透明
- [ ] 无新增 lint/类型错误

## 注意事项

- **不要改设计**：保持当前的粉色心形小人造型，只做矢量化 + 去白底
- **不要嵌入位图**：SVG 内不能用 `<image>` 标签引用 PNG/JPG
- **渐变可简化**：原图是 3D 光泽风格，SVG 可以适当简化为扁平渐变，但要保持粉红+珊瑚的双色调
- **路径要干净**：尽量用最少的 `<path>` 元素，避免工具生成的冗余节点
