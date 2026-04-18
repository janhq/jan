# 模型市场页面响应式布局审查报告

> 审查范围：`marketplace/*` 相关 5 个文件  
> 审查维度：溢出检测、Flex 收缩、Grid 断点、移动端适配、max-width 缺失、Hover 状态溢出

---

## P0 严重

### 1. 滚动区高度硬编码导致双滚动条 / 布局溢出

- **位置**：`web-app/src/routes/marketplace/index.tsx:427`
- **问题描述**：
  滚动容器使用 `h-[calc(100%-60px)]` 硬编码扣减 HeaderPage 高度，但 HeaderPage 下方还动态插入了「已选筛选条」（`activeFilterCount > 0`）和「筛选面板」（`showFilters`）。当这些区域出现时，子元素总高度会超过父容器 `h-full`，导致外层出现整体滚动条，同时滚动容器自身也有 `overflow-y-auto`，形成**双滚动条**或内容被截断。
- **修复建议**：在 `flex flex-col h-full` 父容器中，使用 `flex-1 min-h-0` 让滚动区自动占据剩余空间，而非硬编码高度。
- **修复后代码**：

```tsx
// Before
<div className="p-4 w-full h-[calc(100%-60px)] overflow-y-auto">

// After
<div className="p-4 w-full flex-1 min-h-0 overflow-y-auto">
```

---

## P1 重要

### 2. 顶部搜索栏在窄屏下水平溢出

- **位置**：`web-app/src/routes/marketplace/index.tsx:191–219`
- **问题描述**：
  1. 搜索区容器使用 `w-full` 但缺少 `min-w-0`，在 flex 行中遇到右侧 `shrink-0` 按钮组时，无法充分收缩，导致整体水平溢出。
  2. 右侧按钮组（Token 状态 + 排序下拉 + 筛选按钮）本身无 `flex-wrap`，在 Windows 上叠加 `pr-30` 后，可用宽度被严重挤压，移动端（<400px）几乎必然溢出。
  3. `h-10` 配合 `py-3` 仅留下 16px 内容高度，无法容纳 `size="sm"` 按钮（~32–36px），虽然当前被 HeaderPage 的 60px 高度掩盖，但属于隐患。
- **修复建议**：搜索容器改为 `flex-1 min-w-0`；将固定高度改为 `min-h-10` 并允许换行；右侧按钮组在超小屏可精简文案或使用图标。
- **修复后代码**：

```tsx
// Before
<div
  className={cn(
    'pr-3 py-3 h-10 w-full flex items-center justify-between relative z-20',
    !IS_MACOS && 'pr-30'
  )}
>
  <div className="flex items-center gap-2 w-full">
    <IconSearch className="shrink-0 text-muted-foreground" size={14} />
    <input ... className="w-full focus:outline-none bg-transparent" />
    ...
  </div>
  <div className="flex items-center gap-2 shrink-0">
    ...
  </div>
</div>

// After
<div
  className={cn(
    'pr-3 py-3 min-h-10 w-full flex items-center justify-between relative z-20 flex-wrap gap-y-2',
    !IS_MACOS && 'pr-30'
  )}
>
  <div className="flex items-center gap-2 flex-1 min-w-0">
    <IconSearch className="shrink-0 text-muted-foreground" size={14} />
    <input ... className="w-full min-w-0 focus:outline-none bg-transparent" />
    ...
  </div>
  <div className="flex items-center gap-2 shrink-0 flex-wrap">
    ...
  </div>
</div>
```

---

### 3. ModelTagStrip hover 展开被卡片左侧裁切 + 侵入内容区

- **位置**：`web-app/src/components/marketplace/ModelTagStrip.tsx:30–64`
- **问题描述**：
  1. Tag strip 为 `flex-col items-center`，按钮默认宽 `w-6`（24px），hover 时变为 `w-auto`（约 56–70px）。在 `items-center` 作用下，按钮沿水平交叉轴居中，导致 hover 时**左右等距膨胀**，左侧超出 tag strip 的部分会被卡片父级的 `overflow-hidden` + `rounded-l-lg` **裁切**（文字/图标显示不全）。
  2. 膨胀后的按钮向右侧侵入 `flex-1` 内容区，覆盖标题前几个字符；且 tag 颜色类均为半透明（如 `bg-blue-500/20`），底层文字会**透显**，干扰阅读。
- **修复建议**：将 tag strip 的横向对齐改为 `items-start`（或给每个按钮加 `self-start`），并补充 `pl-1` 缓冲避免贴边；同时给 tag strip 加 `shrink-0` 防止被 flex 压缩。
- **修复后代码**：

```tsx
// Before (line 31)
<div
  className={cn(
    'hidden md:flex w-8 flex-col items-center py-3 gap-1.5 bg-muted/50 rounded-l-lg border-r border-border/50',
    className
  )}
>

// After
<div
  className={cn(
    'hidden md:flex w-8 shrink-0 flex-col items-start pl-1 py-3 gap-1.5 bg-muted/50 rounded-l-lg border-r border-border/50',
    className
  )}
>
```

> 若需彻底解决侵入内容区问题，建议放弃 `hover:w-auto` 宽度动画，直接依赖已有的 `Tooltip` 展示完整标签；或给展开态增加 `hover:shadow-lg` 与更实心的背景色以遮盖底层文字。

---

## P2 一般

### 4. ModelCard 内容区缺少 `min-w-0`

- **位置**：`web-app/src/components/marketplace/ModelCard.tsx:72`
- **问题描述**：卡片整体为 `flex`（横向），左侧 tag strip + 右侧内容区。内容区使用 `flex-1` 但未加 `min-w-0`，在极端窄屏下（或当右侧状态数字极宽时），flex 子元素可能因 `min-width: auto` 拒绝收缩，导致卡片突破 grid 单元格宽度。
- **修复建议**：给内容区添加 `min-w-0`。
- **修复后代码**：

```tsx
// Before
<div className="flex-1 p-4 flex flex-col">

// After
<div className="flex-1 p-4 flex flex-col min-w-0">
```

---

### 5. Tag strip 容器缺少 `shrink-0`

- **位置**：`web-app/src/components/marketplace/ModelTagStrip.tsx:31`
- **问题描述**：tag strip 设置了固定宽 `w-8`（32px），但没有 `shrink-0`。在 flex 行布局中，当内容区发生最小宽度冲突时，固定宽元素仍可能被压缩。
- **修复建议**：已在 P1-3 的修复代码中一并补充 `shrink-0`。

---

### 6. Stats 栏长文本换行对齐不佳

- **位置**：`web-app/src/routes/marketplace/index.tsx:430`
- **问题描述**：
  ```tsx
  <div className="flex items-center text-xs text-muted-foreground">
    <span>共 {totalCount.toLocaleString()} 个模型 · ... 按"{sortLabel}"排序</span>
  </div>
  ```
  该容器为 `flex items-center`，当视口极窄导致文本换行时，`items-center` 会把多行文本的盒子垂直居中，首行视觉上会偏上，显得不够齐整。更关键的是缺少 `min-w-0`，虽然此处单个子元素，但若未来加入 `shrink-0` 的兄弟节点，同样会触发溢出。
- **修复建议**：改为 `items-baseline` 或保留 `items-center` 但同时加 `min-w-0` 与 `flex-wrap` 作为防御性编程。
- **修复后代码**：

```tsx
// Before
<div className="flex items-center text-xs text-muted-foreground">
  <span>...</span>
</div>

// After
<div className="flex items-center flex-wrap min-w-0 text-xs text-muted-foreground">
  <span className="min-w-0">...</span>
</div>
```

---

### 7. 加载更多触发器在 1 列 grid 中的语义冗余

- **位置**：`web-app/src/routes/marketplace/index.tsx:504–516`
- **问题描述**：
  ```tsx
  <div ref={loadMoreRef} className="col-span-full py-4 flex justify-center">
  ```
  `col-span-full` 在 `grid-cols-1`（移动端）下等于 `col-span-1`，表现正常；但在 `md:grid-cols-2` 下会强制占据整行，导致如果最后一行只有 1 个模型卡片时，加载提示下方会出现大片空白（因为它独占一行并把第二列挤空）。视觉上不是严重 bug，但在某些屏幕尺寸下会出现不均匀的底部留白。
- **修复建议**：若希望加载提示紧跟最后一行卡片，可将其移出 grid，放在 grid 之后作为一个普通 block；或者保持现状但增加 `md:col-start-1 md:col-end-3` 的显式声明（与 `col-span-full` 等价，但更清晰）。
- **修复后代码**：

```tsx
// 方案 A：移出 grid
<div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-2">
  {models.map((model) => <ModelCard ... />)}
</div>
<div ref={loadMoreRef} className="py-4 flex justify-center">
  ...
</div>

// 方案 B：保持 grid 内，但显式声明列范围
<div ref={loadMoreRef} className="col-span-1 md:col-span-2 py-4 flex justify-center">
```

---

## 总结

| 严重程度 | 数量 | 关键问题 |
|---------|------|---------|
| P0 | 1 | 滚动区硬编码高度导致双滚动条 |
| P1 | 2 | 搜索栏窄屏溢出；TagStrip hover 被裁切/侵入内容区 |
| P2 | 4 | `min-w-0` 缺失、`shrink-0` 缺失、stats 对齐、加载提示 grid 留白 |

**优先修复顺序**：P0 → P1-3（TagStrip hover 裁切） → P1-2（搜索栏溢出） → P2 防御性补充 `min-w-0` / `shrink-0`。
