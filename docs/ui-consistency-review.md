# UI 视觉一致性审查报告

> **审查范围**：`OpenClawCard.tsx`、`PullModelDialog.tsx`、`routes/hub/index.tsx`  
> **风格标杆**：`components/marketplace/ModelCard.tsx`  
> **审查日期**：2026-04-18  
> **审查人**：UI 视觉专家（AI Agent）

---

## 一、风格标杆特征（ModelCard.tsx）

| 维度 | 标杆值 |
|------|--------|
| **圆角** | `rounded-lg` |
| **阴影** | 默认 `shadow-sm` / Hover `shadow-md` |
| **边框** | `border border-border` / Hover `hover:border-border/80` |
| **颜色** | 纯 CSS 变量：`bg-card`、`text-foreground`、`text-muted-foreground`、`bg-secondary` |
| **暗色模式** | 无 `dark:` 硬编码，CSS 变量驱动 |
| **间距** | `p-4`、`gap-2`、`mt-auto pt-3` |
| **字体** | 标题 `text-sm font-medium`、正文 `text-xs`、标签 `text-[11px]` |
| **图标** | `@tabler/icons-react` |
| **Hover 动效** | `group hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 ease-out` |

---

## 二、OpenClawCard.tsx 审查

### 2.1 评分：⭐⭐⭐☆☆（3/5）

### 2.2 风格差异清单

| 维度 | 当前实现 | 标杆（ModelCard） | 差异等级 |
|------|---------|------------------|---------|
| **圆角** | `rounded-lg` | `rounded-lg` | ✅ 一致 |
| **阴影** | **无** | `shadow-sm` + `hover:shadow-md` | 🔴 **缺失** |
| **边框** | `border border-border` | `border border-border` | ✅ 基础一致；但缺少 `hover:border-border/80` |
| **颜色** | `bg-card`、`text-foreground`、`text-muted-foreground`、`bg-muted/50` | 同上 | ✅ 一致；状态指示器 `bg-red-500`/`bg-orange-400`/`bg-green-500` 为硬编码色值 |
| **暗色模式** | 无 `dark:` 前缀 | CSS 变量驱动 | ✅ 一致 |
| **间距** | `p-3`、`gap-2` | `p-4`、`gap-2/3` | 🟡 `p-3` 偏小，与标杆 `p-4` 不一致 |
| **字体** | `text-sm font-medium`、`text-xs`、`text-[11px]` | 同上 | ✅ 一致 |
| **图标** | `@tabler/icons-react` | `@tabler/icons-react` | ✅ 一致 |
| **Hover 动效** | **无** | `hover:-translate-y-0.5` + `shadow-md` + `transition-all duration-200 ease-out` | 🔴 **完全缺失** |
| **Group** | **无** | `group` | 🟡 缺失，影响 hover 联动样式 |

### 2.3 具体问题

1. **卡片无悬浮感**：缺少 `shadow-sm` 和 `hover:shadow-md`，在页面中视觉上比 `ModelCardItem`（index.tsx 内联）扁平。
2. **内边距不一致**：`p-3` 小于标杆的 `p-4`，导致信息密度过高，与周边 `ModelCardItem` 的呼吸感不匹配。
3. **无交互反馈**：没有 `transition-all duration-200 ease-out`，鼠标悬停时状态变化生硬。
4. **状态点颜色硬编码**：`bg-red-500`、`bg-orange-400`、`bg-green-500` 不是语义化 CSS 变量。虽然功能正确，但在主题切换时可能不够协调。
5. **与页面内联版本风格分裂**：`routes/hub/index.tsx` 中内联的 `OpenClawStatusCard` 使用 `p-4 gap-3`，而独立组件 `OpenClawCard.tsx` 使用 `p-3 gap-2`，两者尚未统一。

### 2.4 修复建议（className 修改）

```tsx
// 当前代码（第 69-73 行）
className={cn(
  'bg-card border border-border rounded-lg p-3 flex flex-col gap-2',
  status === 'running' && 'border-green-500/30',
  className
)}

// 建议修改
className={cn(
  'group flex bg-card border border-border rounded-lg p-4 flex flex-col gap-3',
  'shadow-sm hover:shadow-md hover:border-border/80',
  'transition-all duration-200 ease-out',
  status === 'running' && 'border-green-500/30',
  className
)}
```

**附加建议**：
- 状态指示器点若需完全对齐设计系统，可改用语义色：`bg-destructive`（红）、`bg-amber-500`（橙，若 theme 无 warning 变量则保留 `bg-orange-400`）、`bg-emerald-500`（绿）。
- 按钮区域目前使用 `h-7` 高度，建议确认与 `ModelCardItem` 中按钮的 `h-7 text-xs` 保持一致（当前已一致，无需改动）。

---

## 三、PullModelDialog.tsx 审查

### 3.1 评分：⭐⭐⭐⭐☆（4/5）

### 3.2 风格差异清单

| 维度 | 当前实现 | 标杆（ModelCard） | 差异等级 |
|------|---------|------------------|---------|
| **圆角** | Dialog 自带；内部 `rounded-lg`/`rounded-md` | `rounded-lg` | ✅ 一致 |
| **阴影** | Dialog Overlay 自带阴影；内部无 Card 阴影 | `shadow-sm`/`shadow-md` | ⚪ 不适用（Dialog 语义） |
| **边框** | `border-border` / `border-primary`（选中态） | `border-border` | ✅ 一致 |
| **颜色** | `bg-card`、`bg-muted/50`、`bg-primary/5`、`text-primary`、`text-foreground`、`text-muted-foreground`、`hover:bg-accent` | CSS 变量驱动 | ✅ 非常规范 |
| **暗色模式** | 无 `dark:` 前缀 | CSS 变量驱动 | ✅ 一致 |
| **间距** | `gap-4`、`p-3`、`px-3 py-2` | `p-4`、`gap-2/3` | ✅ 合理 |
| **字体** | `text-sm`、`text-xs`、`text-[11px]` | 同上 | ✅ 一致 |
| **图标** | `@tabler/icons-react` | `@tabler/icons-react` | ✅ 一致 |
| **组件规范** | Mirror 选择器使用原生 `<button>` | shadcn/ui `<Button>` | 🟡 建议统一组件 |

### 3.3 具体问题

1. **Mirror 源选择器未使用 `<Button>` 组件**：当前使用原生 `<button>` 手写样式（第 110-137 行）。虽然视觉样式已覆盖 `border`、`bg`、`text`、`rounded`、`transition-colors`，但缺失了 shadcn/ui 的无障碍属性（focus ring、aria 状态等），也与项目其他按钮交互体感不完全一致。
2. **与 `routes/hub/index.tsx` 内联 Dialog 风格分裂**：页面内存在两套"拉取模型"弹窗实现：
   - `PullModelDialog.tsx`（独立组件）：含 Mirror 选择器、精致进度面板、`size="sm"` 按钮、`showCloseButton={!isPulling}`。
   - `routes/hub/index.tsx` 内联 Dialog（第 726-795 行）：无 Mirror 选择器、进度区域样式更简陋（`gap-1.5`、无 `bg-muted/50` 背景块）、按钮无 `size="sm"`、无 `showCloseButton` 控制。
   这会导致用户在不同入口看到视觉上不一致的弹窗。
3. **进度区域文字粗细**：当前使用 `font-medium` 显示 `progress.status`（第 145 行），而 `routes/hub/index.tsx` 内联版本使用普通字重。两者应统一。

### 3.4 修复建议

**建议 1：Mirror 选择器改用 `<Button>` 组件（可选，视觉影响小，规范影响大）**

```tsx
// 当前：原生 button
<button
  type="button"
  className={cn(
    'flex-1 flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors',
    mirror === 'ollama'
      ? 'border-primary bg-primary/5 text-primary'
      : 'border-border bg-card text-muted-foreground hover:bg-accent'
  )}
>

// 建议：使用 Button variant="outline" 并覆盖选中态
// 或者保持当前写法，但补充 focus-visible ring：
className={cn(
  'flex-1 flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  // ...原有条件样式
)}
```

**建议 2：统一进度面板样式（若 index.tsx 最终迁移到 PullModelDialog）**

当前 `PullModelDialog.tsx` 的进度面板已更精致（带 `bg-muted/50` 背景块），建议将 `routes/hub/index.tsx` 中的内联 Dialog 彻底替换为 `<PullModelDialog />` 组件，消除两套实现。

**建议 3：进度状态文字字重**

如希望与标杆的 muted 风格更贴近，可将 `font-medium` 去掉：

```tsx
// 第 145 行当前
<span className="text-foreground font-medium">{progress.status}</span>

// 建议（更柔和，与 ModelCard 描述文字风格一致）
<span className="text-foreground">{progress.status}</span>
```

---

## 四、routes/hub/index.tsx 关联审查

### 4.1 内联组件与标杆对比

| 组件 | 圆角 | 阴影 | 边框 | Hover 动效 | 评分 |
|------|------|------|------|-----------|------|
| `OllamaStatusCard` | `rounded-lg` | ❌ 无 | `border-border` | ❌ 无 | ⭐⭐⭐☆☆ |
| `OpenClawStatusCard` | `rounded-lg` | ❌ 无 | `border-border` | ❌ 无 | ⭐⭐⭐☆☆ |
| `ModelCardItem` | `rounded-lg` | `shadow-sm`/`hover:shadow-md` | `border-border`/`hover:border-border/80` | ✅ 完整 | ⭐⭐⭐⭐⭐ |
| `RunningModelRow` | `rounded-md` | ❌ 无 | `border-border/50` | ❌ 无 | ⭐⭐⭐☆☆ |

### 4.2 关键发现

- **`ModelCardItem` 是标杆级实现**：与 `ModelCard.tsx` 几乎完全一致（`group flex flex-col` + `shadow-sm` + `hover:shadow-md` + `transition-all duration-200 ease-out`），说明页面开发者已经知道正确写法。
- **状态卡片（Ollama/OpenClaw）普遍缺阴影和 Hover 动效**：`OllamaStatusCard` 和 `OpenClawStatusCard` 均使用 `bg-card border border-border rounded-lg p-4 flex flex-col gap-3`，但缺少 `shadow-sm` 和 hover 提升效果。这导致它们在 `ModelCardItem` 旁边显得扁平、层级感弱。
- **同一页面存在两套 Pull Dialog**：`routes/hub/index.tsx` 第 726-795 行的内联 Dialog 与 `PullModelDialog.tsx` 独立组件并存，视觉细节差异明显（按钮尺寸、进度面板背景、Mirror 选择器有无）。**强烈建议删除内联实现，统一使用 `<PullModelDialog />` 组件。**

### 4.3 状态卡片统一修复建议

将 `OllamaStatusCard` 和 `OpenClawStatusCard` 的外层容器修改为：

```tsx
<div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3 shadow-sm hover:shadow-md hover:border-border/80 transition-all duration-200 ease-out">
```

> **注意**：状态卡片是功能性信息面板，hover 动效优先级低于模型卡片，但加上 `shadow-sm` 至少能保证基础层级一致。

---

## 五、总结与优先级

| 优先级 | 问题 | 影响文件 | 建议操作 |
|--------|------|---------|---------|
| 🔴 P0 | `routes/hub/index.tsx` 内联 Pull Dialog 与 `PullModelDialog.tsx` 并存 | `routes/hub/index.tsx` | **删除内联 Dialog，统一使用 `<PullModelDialog />` 组件** |
| 🔴 P0 | `OpenClawCard.tsx` 缺少阴影和 hover 动效 | `OpenClawCard.tsx` | 添加 `shadow-sm hover:shadow-md` + `transition-all duration-200 ease-out` |
| 🟡 P1 | 状态卡片（Ollama/OpenClaw）padding 不一致 | `OpenClawCard.tsx` | `p-3` → `p-4`，`gap-2` → `gap-3` |
| 🟡 P1 | 状态卡片在 index.tsx 中缺阴影 | `routes/hub/index.tsx` | 给 `OllamaStatusCard`、`OpenClawStatusCard` 添加 `shadow-sm` |
| 🟢 P2 | Mirror 选择器使用原生 `<button>` | `PullModelDialog.tsx` | 补充 `focus-visible:ring` 或改用 `<Button variant="outline">` |
| 🟢 P2 | 状态指示器颜色硬编码 | `OpenClawCard.tsx` | 评估是否改用 `bg-destructive`/`bg-emerald-500` 等语义变量 |

---

*报告结束。本审查仅涉及视觉风格，未审查功能逻辑或类型安全。*
