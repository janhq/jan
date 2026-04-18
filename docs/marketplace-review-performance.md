# 模型市场页面性能审查报告

> 审查范围：`marketplace/index.tsx`, `ModelCard.tsx`, `ModelTagStrip.tsx`, `tagConstants.ts`, `useModelScope.ts`
> 审查时间：2026-04-18

---

## P0 严重

### 1. `marketplace/index.tsx:492-498` — `onClick` 内联箭头函数导致全列表级联重渲染

**问题描述**
`models.map()` 循环中为每个 `ModelCard` 传递了内联箭头函数 `onClick={() => navigate(...)}`。该函数在 `MarketplaceContent` 每次渲染（如搜索输入、筛选器切换、`loading` 状态变化）时都会重新创建。即使后续给 `ModelCard` 加上 `React.memo`，该 prop 的引用变化也会强制所有卡片失效并重渲染。

**修复建议**
将 `onClick` 改为接收 `modelId` 的稳定回调，并在 `ModelCard` 内部用 `useCallback` 二次封装。

**修复后代码片段**

```tsx
// marketplace/index.tsx
const handleCardClick = useCallback(
  (modelId: string) => {
    navigate({
      to: route.marketplace.model,
      params: { modelId },
      search: { repo: modelId },
    })
  },
  [navigate]
)

// ...
{models.map((model) => (
  <ModelCard
    key={model.id}
    model={model}
    onClick={handleCardClick}
    onTagClick={handleTagClick}
  />
))}
```

```tsx
// ModelCard.tsx
const ModelCard = React.memo(function ModelCard({
  model,
  onClick,
  onTagClick,
}: ModelCardProps) {
  const handleClick = useCallback(() => {
    onClick?.(model.id)
  }, [onClick, model.id])

  // ...
  return (
    <div
      className={...}
      onClick={handleClick}
    >
```

---

### 2. `useModelScope.ts:111-117` — `loadMore` 回调引用极不稳定

**问题描述**
`loadMore` 的依赖列表为 `[state.loading, state.hasMore, params, fetchModels]`。其中 `state.loading` 在每次开始/结束请求时都会翻转，`params` 在筛选切换时也会变化，导致 `loadMore` 几乎每次状态更新都是新引用。

**修复建议**
通过 `useRef` 保存最新的 `state` 和 `params`，让 `loadMore` 的依赖列表为空（或仅保留真正需要触发重创建的逻辑）。

**修复后代码片段**

```tsx
// useModelScope.ts
export function useModelScope() {
  // ...
  const stateRef = useRef(state)
  stateRef.current = state

  const paramsRef = useRef(params)
  paramsRef.current = params

  const fetchModelsRef = useRef(fetchModels)
  fetchModelsRef.current = fetchModels

  const loadMore = useCallback(() => {
    const s = stateRef.current
    const p = paramsRef.current
    if (s.loading || !s.hasMore) return
    const nextPage = (p.page_number ?? 1) + 1
    const nextParams = { ...p, page_number: nextPage }
    setParams(nextParams)
    fetchModelsRef.current(nextParams, true)
  }, [])

  // ...
}
```

---

### 3. `marketplace/index.tsx:73-85` — IntersectionObserver 因 `loadMore` 变化频繁重建

**问题描述**
`useEffect` 的依赖数组包含 `loadMore`。由于问题 2，`loadMore` 频繁变化，导致每次都会 `observer.disconnect()` 并新建 `IntersectionObserver`、重新 `observe()`。虽然单次开销不大，但在快速滚动或状态抖动时会累积成明显的卡顿。

**修复建议**
用 `useRef` 保存最新的 `loadMore` 回调，将 effect 依赖从 `loadMore` 中移除，仅保留 `hasMore` 和 `loading`。

**修复后代码片段**

```tsx
// marketplace/index.tsx
function MarketplaceContent() {
  // ...
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const loadMoreCallbackRef = useRef(loadMore)
  loadMoreCallbackRef.current = loadMore

  useEffect(() => {
    if (!loadMoreRef.current || !hasMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading) {
          loadMoreCallbackRef.current()
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(loadMoreRef.current)
    return () => observer.disconnect()
  }, [hasMore, loading]) // 移除 loadMore

  // ...
}
```

---

## P1 明显

### 4. `ModelCard.tsx:19` — `ModelCard` 未使用 `React.memo`

**问题描述**
`ModelCard` 是纯展示组件，接收的 `model` 对象引用通常稳定（来自 Zustand / useState）。但由于当前父组件传递了不稳定的 `onClick`（问题 1），每次父组件渲染都会导致所有卡片重渲染。先修复问题 1，再为 `ModelCard` 加上 `React.memo` 才能生效。

**修复建议**
在修复问题 1 的前提下，将 `ModelCard` 用 `React.memo` 包裹。同时注意 `model` 对象的引用稳定性（目前来自不可变数组追加，引用通常稳定）。

**修复后代码片段**

```tsx
// ModelCard.tsx
export const ModelCard = React.memo(function ModelCard({
  model,
  onClick,
  onTagClick,
}: ModelCardProps) {
  // ... 组件实现不变
})
```

---

### 5. `ModelTagStrip.tsx:20` — `ModelTagStrip` 未使用 `React.memo`

**问题描述**
`ModelTagStrip` 内部包含 `Tooltip`（Radix UI 组件，创建 Portal 和全局事件监听）。若父组件 `ModelCard` 因任何原因重渲染（例如父级 `MarketplaceContent` 的 `loading` 状态变化导致整个 grid 重渲染），每个 `ModelTagStrip` 及其内部的 `Tooltip` 都会重新挂载/更新，成本较高。

**修复建议**
包裹 `React.memo`。该组件的 props（`model`、`onTagClick`）在优化后均能保持稳定引用。

**修复后代码片段**

```tsx
// ModelTagStrip.tsx
export const ModelTagStrip = React.memo(function ModelTagStrip({
  model,
  onTagClick,
  className,
}: ModelTagStripProps) {
  // ... 组件实现不变
})
```

---

### 6. `ModelCard.tsx:60-65` — `transition-all` 动画性能差

**问题描述**
className 中包含 `transition-all duration-200 ease-out`。`transition-all` 会监听所有可过渡属性的变化，而不仅仅是实际发生变化的 `transform`（`hover:-translate-y-0.5`）。浏览器需要为更多属性维护过渡状态，增加了合成器（compositor）负担。此外，`ease-out` 在快速滚动时可能造成 perceived jank。

**修复建议**
明确只过渡 `transform` 和 `box-shadow`（如果 shadow 也变化），使用 `will-change` 需谨慎（GPU 内存占用），此处用精确的 `transition` 属性即可。

**修复后代码片段**

```tsx
// ModelCard.tsx
<div
  className={cn(
    'group flex rounded-lg border border-border bg-card shadow-sm min-h-[140px] overflow-hidden',
    'cursor-pointer hover:-translate-y-0.5 hover:shadow-md hover:border-border/80',
    'transition-transform transition-shadow duration-200 ease-out'
  )}
  onClick={handleClick}
>
```

---

### 7. `ModelTagStrip.tsx:50` — tag 按钮 `transition-all` 性能差

**问题描述**
tag 按钮 hover 时宽度从 `w-6` 展开到 `hover:w-auto`，同时使用了 `transition-all duration-200 ease-out`。宽度（`width`）变化会触发 **Layout（重排）**，而 `transition-all` 会强制浏览器监听所有属性，将本可局限在布局阶段的计算扩散到合成阶段。

**修复建议**
由于宽度变化本身无法避免（从固定宽度到 auto），至少将 `transition-all` 改为 `transition-[width,opacity] duration-200`，减少浏览器监听面。

**修复后代码片段**

```tsx
// ModelTagStrip.tsx
className={cn(
  'group relative z-0 hover:z-10 h-6 w-6 hover:w-auto rounded-sm',
  'flex items-center justify-center overflow-hidden whitespace-nowrap',
  'px-0 hover:px-1.5 border cursor-pointer',
  'transition-[width,opacity] duration-200 ease-out',
  tag.colorClass
)}
```

---

### 8. `marketplace/index.tsx:87-153` — `activeFilterCount` / `activeFilters` 过度使用 `useMemo`

**问题描述**
两处 `useMemo` 的计算成本极低（几次 `if` 判断和小数组的 `find`）。`useMemo` 本身需要维护依赖数组的浅比较、缓存结果对象，在计算量很小时，其自身开销往往大于收益。反而因为返回了新的 memoized 数组/对象，如果这些值被误用到其他 effect 依赖中，会造成难以调试的 stale closure。

**修复建议**
移除这两处 `useMemo`，直接在组件体中计算。React 的渲染非常快，此类轻量计算不需要记忆化。

**修复后代码片段**

```tsx
// marketplace/index.tsx
function MarketplaceContent() {
  // ...
  const activeFilterCount =
    (params.filter_task ? 1 : 0) +
    (params.filter_library ? 1 : 0) +
    (params.filter_model_type ? 1 : 0) +
    (params.filter_custom_tag ? 1 : 0) +
    (params.filter_license ? 1 : 0) +
    (params.filter_deploy ? 1 : 0)

  const activeFilters: Array<{
    key: keyof ListModelScopeModelsParams
    label: string
    value: string
  }> = []
  if (params.filter_task) {
    const opt = MODELSCOPE_TASK_OPTIONS.find(
      (o) => o.value === params.filter_task
    )
    activeFilters.push({
      key: 'filter_task',
      label: '任务',
      value: opt?.label || params.filter_task,
    })
  }
  // ... 其余 filter 类似处理
}
```

---

### 9. `ModelCard.tsx:57` — `mobileTags` 的 `useMemo` 收益为负

**问题描述**
`getModelTags(model)` 内部仅做少量字符串比较和数组 push，计算成本低于 `useMemo` 的依赖比较和缓存维护。且 `model` 是对象，React 的依赖比较是浅比较（`Object.is`），如果父组件不小心传了新引用（虽然当前代码不会），memo 会失效。

**修复建议**
移除 `useMemo`，直接调用函数。

**修复后代码片段**

```tsx
// ModelCard.tsx
const mobileTags = getModelTags(model)
```

---

### 10. `ModelTagStrip.tsx:25` — `tags` 的 `useMemo` 收益为负

**问题描述**
与问题 9 相同，`getModelTags` 计算量极小，`useMemo` 在此场景下是负优化。

**修复建议**
移除 `useMemo`。

**修复后代码片段**

```tsx
// ModelTagStrip.tsx
const tags = getModelTags(model)
```

---

### 11. `marketplace/index.tsx:441-460` — Skeleton 占位数组每次渲染重建

**问题描述**
`[...Array(6)].map((_, i) => (...))` 在 `loading && models.length === 0` 的每次渲染中都会创建一个新数组。虽然 React 的 `key={i}` 能避免 DOM 重建，但数组和函数的创建是不必要的。

**修复建议**
提取为模块级常量。

**修复后代码片段**

```tsx
// marketplace/index.tsx (模块顶层)
const SKELETON_ARRAY = Array.from({ length: 6 }, (_, i) => i)

// 组件内
{loading && models.length === 0 ? (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-pulse">
    {SKELETON_ARRAY.map((i) => (
      <div key={i} className="bg-card border border-border rounded-lg p-4">
        {/* ... */}
      </div>
    ))}
  </div>
) : ...}
```

---

### 12. `ModelCard.tsx:129` — `model.tasks?.slice(0, 2)` 每次渲染创建新数组

**问题描述**
在 JSX 中直接 `slice()` 会生成新的临时数组。React 渲染时会用它做 `map` 遍历。虽然 `key={task}` 使用字符串避免了 key 问题，但每次渲染的数组引用不同，如果该结果被下游组件或 hook 使用，会导致不必要的重渲染。

**修复建议**
当前仅用于渲染，不影响 memo。若追求极致可预计算，但优先级较低。建议保持现状或配合 `useMemo`（若整个卡片已 memo，则此处 slice 只会在卡片真正重渲染时执行，问题不大）。

**修复后代码片段（可选）**

```tsx
// ModelCard.tsx
const topTasks = useMemo(() => model.tasks?.slice(0, 2) ?? [], [model.tasks])

// ...
{topTasks.map((task) => (
  <span key={task}>...</span>
))}
```

---

### 13. `marketplace/index.tsx:504-516` — `loadMoreRef` 的条件渲染导致节点不稳定

**问题描述**
`loadMoreRef` 所在的 `<div>` 内部包含条件渲染的 `Loader` 和 "已加载全部" 文本。当 `loading` 从 `false` → `true` 时，`Loader` 出现；当 `hasMore` 变为 `false` 时，文本出现。由于这些条件都在同一个 `div` 内，`div` 本身不会消失，但内部结构变化可能触发 React 的 reconciliation 对 ref 的处理产生微小抖动。更关键的是，当 `hasMore` 变为 `false` 时，effect 会 cleanup observer（正确行为），但 `loading` 的频繁翻转会导致 observer 反复重建（在问题 3 修复后，`loading` 仍在依赖中）。

**修复建议**
将 `loadMoreRef` 所在的 div 与条件内容分离，保持 ref 节点的稳定性。

**修复后代码片段**

```tsx
// marketplace/index.tsx
<div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-2">
  {models.map((model) => (
    <ModelCard key={model.id} ... />
  ))}
</div>

{/* 独立、稳定的触发器节点 */}
<div ref={loadMoreRef} className="py-4 flex justify-center">
  {loading && models.length > 0 && (
    <Loader className="size-5 animate-spin text-muted-foreground" />
  )}
  {!hasMore && models.length > 0 && (
    <span className="text-xs text-muted-foreground">
      已加载全部 {models.length.toLocaleString()} 个模型
    </span>
  )}
</div>
```

---

## P2 轻微 / 潜在

### 14. `tagConstants.ts:210-213, 226-228` — `Object.entries` 重复执行

**问题描述**
`getModelTags` 每次调用都执行 `Object.entries(frameworkConfigs)` 和 `Object.entries(licenseConfigs)`。这两个配置对象是静态的，可以提取为模块级常量。

**修复建议**
在模块顶层预计算 entries。

**修复后代码片段**

```ts
// tagConstants.ts (模块顶层)
const FRAMEWORK_ENTRIES = Object.entries(frameworkConfigs)
const LICENSE_ENTRIES = Object.entries(licenseConfigs)

export function getModelTags(model: ModelScopeModel): TagItem[] {
  // ...
  const fwEntry = FRAMEWORK_ENTRIES.find(
    ([key]) =>
      tagStrs.some((t) => t.includes(key)) || modelIdLower.includes(key)
  )
  // ...
  const licenseEntry = LICENSE_ENTRIES.find(([key]) =>
    licenseLower.includes(key)
  )
  // ...
}
```

---

### 15. `tagConstants.ts:192-251` — `getModelTags` 返回全新对象数组

**问题描述**
每次调用 `getModelTags` 都返回一个新的 `TagItem[]` 数组，其中每个元素都是新对象。如果调用方将该结果用于 `useEffect` 依赖或子组件 props 比较，会导致级联重渲染。目前 `ModelCard` 和 `ModelTagStrip` 用 `model` 作为 `useMemo` 依赖，规避了此问题，但这是脆弱的约定。

**修复建议**
该问题当前未触发实际 bug，但建议标注函数签名说明其返回新对象，或考虑在数据层（`useModelScope` 获取模型时）就预计算 `tags` 并缓存到 model 对象上。

---

### 16. `ModelCard.tsx:25-52` — `isLoading` prop 为死代码

**问题描述**
`isLoading` prop 在 `ModelCardProps` 中定义，且组件内有完整的 Skeleton 分支，但父组件 `marketplace/index.tsx` 在调用 `<ModelCard>` 时从未传入该 prop，因此该分支永远不会执行。死代码增加了组件复杂度和包体积。

**修复建议**
移除 `isLoading` prop 及其 Skeleton 分支。若需要加载占位，已在父组件的 grid Skeleton 中实现。

**修复后代码片段**

```tsx
// ModelCard.tsx
export interface ModelCardProps {
  model: ModelScopeModel
  onClick?: (modelId: string) => void
  onTagClick?: (
    type: 'task' | 'library' | 'license' | 'params',
    value: string
  ) => void
}

export const ModelCard = React.memo(function ModelCard({
  model,
  onClick,
  onTagClick,
}: ModelCardProps) {
  // 直接移除 isLoading 分支
  // ...
})
```

---

### 17. `useModelScope.ts:39-43` — token 加载 effect 缺少 cleanup

**问题描述**
`useEffect` 中调用 `invoke('get_modelscope_token')`，若组件在 Promise resolve 前卸载，`setTokenState(t)` 会在已卸载组件上执行。React 18 中虽然不会报错，但属于不良实践，且如果后续在该 effect 中扩展更多逻辑（如日志），可能引发内存泄漏。

**修复建议**
增加 `mounted` flag 或 `AbortController` 式的取消逻辑。

**修复后代码片段**

```tsx
// useModelScope.ts
useEffect(() => {
  let mounted = true
  invoke<string | null>('get_modelscope_token')
    .then((t) => {
      if (mounted) setTokenState(t)
    })
    .catch(() => {
      if (mounted) setTokenState(null)
    })
  return () => {
    mounted = false
  }
}, [])
```

---

### 18. `useModelScope.ts:56-89` — `AbortController` 无法取消 Tauri invoke

**问题描述**
代码使用 `AbortController` 试图取消前一次请求，但 Tauri 的 `invoke` API **不支持** `AbortSignal`。`abortRef.current?.abort()` 只能设置 `signal.aborted = true`，已发出的 Rust 命令仍会继续执行直到完成，前端在 `await` 之后通过后验检查丢弃结果。这导致 pending 的 Rust 调用在后台堆积，浪费 IPC 和计算资源。

**修复建议**
Tauri v2 的 `invoke` 目前不支持取消。建议：
1. 在 Rust 端为 `list_modelscope_models` 实现请求去重/取消逻辑（如基于 request_id）。
2. 或在 JavaScript 层做防抖：在 `fetchModels` 入口处增加 debounce（例如 150ms），避免筛选条件快速切换时连续发出多个请求。

**修复后代码片段（前端防抖）**

```tsx
// useModelScope.ts
const fetchModels = useCallback(
  async (overrideParams?: ListModelScopeModelsParams, append = false) => {
    // 立即 abort 逻辑保留（用于丢弃旧结果）
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    // 若需要，可在此加显式的 Promise 竞态检查
    // ...
  },
  [params, token]
)
```

更彻底的修复需在 Rust command 中支持取消令牌。

---

### 19. 大数据集缺少虚拟滚动

**问题描述**
当前实现将已加载的所有模型直接渲染到 DOM 中。当用户滚动加载到 1000+ 模型时：
- 每个 `ModelCard` 包含复杂的子树（`ModelTagStrip`、多个 `Tooltip`、SVG Icon、条件渲染块）。
- 即使 `React.memo` 阻止了 React re-render，浏览器仍需维护巨大的 DOM 树和布局信息，滚动时合成器压力大。
- 内存占用随模型数量线性增长。

**修复建议**
引入虚拟滚动库（如 `@tanstack/react-virtual` 或 `react-window`）。由于布局是响应式 grid（1 列 / 2 列），推荐使用 `@tanstack/react-virtual` 配合 `measureElement` 动态测量卡片高度。

**修复后代码片段（概念）**

```tsx
// marketplace/index.tsx
import { useVirtualizer } from '@tanstack/react-virtual'

function MarketplaceContent() {
  const parentRef = useRef<HTMLDivElement>(null)

  const rowVirtualizer = useVirtualizer({
    count: models.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 160, // min-h-[140px] + gap
    measureElement: (el) => el.getBoundingClientRect().height,
    overscan: 5,
  })

  return (
    <div ref={parentRef} className="overflow-y-auto h-full">
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualItem) => {
          const model = models[virtualItem.index]
          return (
            <div
              key={model.id}
              ref={rowVirtualizer.measureElement}
              data-index={virtualItem.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <ModelCard
                model={model}
                onClick={handleCardClick}
                onTagClick={handleTagClick}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

> 注意：虚拟滚动与双列 grid 布局需要额外处理（可将两列视为一个虚拟行，或改用 CSS columns），这是一个中等复杂度的改造，建议在列表长度确实达到瓶颈时实施。

---

## 总结与优先级

| 优先级 | 问题 | 文件 | 预估收益 |
|--------|------|------|----------|
| P0 | `onClick` 内联函数 | `marketplace/index.tsx` | ★★★★★ 消除全列表级联渲染 |
| P0 | `loadMore` 不稳定 | `useModelScope.ts` | ★★★★★ 消除 Observer 反复重建 |
| P0 | IntersectionObserver 依赖 | `marketplace/index.tsx` | ★★★★★ 同上 |
| P1 | `ModelCard` 无 memo | `ModelCard.tsx` | ★★★★☆ 大幅削减重渲染面 |
| P1 | `ModelTagStrip` 无 memo | `ModelTagStrip.tsx` | ★★★★☆ 削减 Tooltip 重渲染 |
| P1 | `transition-all` 动画 | `ModelCard.tsx`, `ModelTagStrip.tsx` | ★★★☆☆ 减少合成器负担 |
| P1 | `useMemo` 过度使用 | `marketplace/index.tsx`, `ModelCard.tsx`, `ModelTagStrip.tsx` | ★★★☆☆ 简化心智模型 |
| P2 | 虚拟滚动缺失 | `marketplace/index.tsx` | ★★★★★（千级数据时） |

**推荐实施顺序**：先修复 3 个 P0 问题（消除最频繁的强制重渲染），然后加 `React.memo`（P1 #4、#5），最后清理 `useMemo` 和 `transition-all`（P1 #6~#11）。虚拟滚动（P2 #19）作为长尾数据量下的保底方案，可在性能监控发现 DOM 节点过多时再实施。