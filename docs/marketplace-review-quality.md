# 模型市场页面代码质量审查报告

> 审查范围：`web-app/src/routes/marketplace/index.tsx`、`ModelCard.tsx`、`ModelTagStrip.tsx`、`tagConstants.ts`、`useModelScope.ts`  
> 审查日期：2026-04-18  
> 审查维度：组件职责、代码重复、Magic Number、错误处理、硬编码文本、样式一致性、文件组织、注释质量、TODO/FIXME

---

## 1. 组件职责

### 问题 1.1

- **位置**：`web-app/src/routes/marketplace/index.tsx`（整文件，554 行）
- **严重程度**：P1
- **问题描述**：页面组件 `MarketplaceContent` 过于庞大（524 行 JSX + 逻辑），承担了搜索、防抖、无限滚动、筛选状态管理、Token 配置弹窗、排序下拉、过滤标签栏、统计信息、加载/空态/错误态渲染等十余项职责。单个文件超过 500 行严重影响可读性和可维护性。
- **修复建议**：按职责拆分为多个子组件/容器：
  - `MarketplaceSearchBar` — 搜索输入
  - `MarketplaceFilterBar` / `MarketplaceFilterPanel` — 筛选标签与筛选面板
  - `MarketplaceTokenDialog` — Token 配置弹窗（应复用现有 Dialog 组件）
  - `MarketplaceStatsBar` — 统计信息
  - `ModelGrid` — 模型卡片网格 + 无限滚动 + 各类状态渲染
- **修复后的代码片段**：
  ```tsx
  // index.tsx 精简后仅保留数据流编排（约 60 行）
  function MarketplaceContent() {
    const { models, loading, error, hasMore, ...actions } = useModelScope()
    return (
      <div className="flex flex-col h-svh w-full">
        <MarketplaceHeader actions={actions} />
        <MarketplaceFilterBar filters={filters} onRemove={...} />
        <ModelGrid
          models={models}
          loading={loading}
          error={error}
          hasMore={hasMore}
          onLoadMore={actions.loadMore}
          onTagClick={handleTagClick}
        />
      </div>
    )
  }
  ```

### 问题 1.2

- **位置**：`web-app/src/components/marketplace/ModelCard.tsx`（第 25–52 行、第 59–148 行）
- **严重程度**：P1
- **问题描述**：`ModelCard` 同时承担骨架屏（Skeleton）和真实卡片两种渲染模式，且骨架屏的 DOM 结构与真实卡片高度重复。当真实卡片样式调整时，骨架屏几乎必然失步。
- **修复建议**：将骨架屏提取为独立组件 `ModelCardSkeleton`，并确保其外层容器与 `ModelCard` 完全一致，内部仅使用 `Skeleton` 占位。
- **修复后的代码片段**：
  ```tsx
  // ModelCardSkeleton.tsx
  export function ModelCardSkeleton() {
    return (
      <div className="flex rounded-lg border border-border bg-card shadow-sm min-h-[140px] overflow-hidden">
        <div className="hidden md:flex w-8 flex-col items-center py-3 gap-1.5 bg-muted/50 rounded-l-lg border-r border-border/50">
          <Skeleton className="h-6 w-6 rounded-sm" />
          <Skeleton className="h-6 w-6 rounded-sm" />
          <Skeleton className="h-6 w-6 rounded-sm" />
        </div>
        <div className="flex-1 p-4 flex flex-col gap-2">
          {/* ... */}
        </div>
      </div>
    )
  }
  ```

### 问题 1.3

- **位置**：`web-app/src/hooks/useModelScope.ts`（第 20–144 行、第 146–180 行）
- **严重程度**：P1
- **问题描述**：单个文件定义了两个独立 Hook：`useModelScope`（列表）和 `useModelScopeDetail`（详情）。二者状态逻辑、错误处理模式完全不同，不应放在同一文件。
- **修复建议**：拆分为 `useModelScope.ts` 和 `useModelScopeDetail.ts`。

---

## 2. 代码重复

### 问题 2.1

- **位置**：`web-app/src/components/marketplace/ModelCard.tsx`（第 74–95 行）与 `ModelTagStrip.tsx`（第 36–71 行）
- **严重程度**：P1
- **问题描述**：移动端水平标签栏（`ModelCard` 内）与桌面端纵向标签条（`ModelTagStrip`）在标签渲染逻辑上高度重复：都遍历 `getModelTags(model)`、都渲染 `Icon`、都应用 `colorClass`、都处理 `onTagClick` + `stopPropagation`。区别在于布局和是否使用 Tooltip。
- **修复建议**：在 `ModelTagStrip` 或新的 `ModelTagItem` 组件中封装单个标签的渲染，支持 `layout: 'horizontal' | 'vertical'` prop，或至少提取 `ModelTagButton` 公共组件。
- **修复后的代码片段**：
  ```tsx
  // ModelTagButton.tsx
  function ModelTagButton({ tag, layout, onClick }: ModelTagButtonProps) {
    const Icon = tag.icon
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClick?.(tag.type, tag.value); }}
        className={cn(
          'inline-flex items-center gap-1 rounded-sm border transition-colors',
          layout === 'horizontal'
            ? 'px-1.5 py-0.5 text-[10px] font-medium max-w-full'
            : 'group relative z-0 hover:z-10 h-6 w-6 hover:w-auto px-0 hover:px-1.5 overflow-hidden whitespace-nowrap',
          tag.colorClass
        )}
      >
        {Icon && <Icon size={12} className="shrink-0" />}
        <span className={cn(layout === 'vertical' && 'ml-0 w-0 opacity-0 group-hover:ml-1 group-hover:w-auto group-hover:opacity-100 transition-all duration-200')}>
          {tag.label}
        </span>
      </button>
    )
  }
  ```

### 问题 2.2

- **位置**：`web-app/src/components/marketplace/tagConstants.ts`（第 25–187 行）
- **严重程度**：P1
- **问题描述**：`colorClass` 字符串在 `taskConfigs`、`frameworkConfigs`、`licenseConfigs`、`getParamsConfig` 中重复了 20 余次，模式完全一致：`bg-{color}-500/20 text-{color}-600 border-{color}-500/30 dark:bg-{color}-500/20 dark:text-{color}-400`。违反 DRY 原则，且维护成本极高（一旦设计系统调整透明度或暗黑模式配色，需要修改 20+ 处）。
- **修复建议**：引入颜色工厂函数 `makeTagColorClasses(color: string)` 统一生成。
- **修复后的代码片段**：
  ```ts
  function makeTagColorClasses(color: string) {
    return `bg-${color}-500/20 text-${color}-600 border-${color}-500/30 dark:bg-${color}-500/20 dark:text-${color}-400`
  }

  const taskConfigs = {
    'text-generation': {
      abbr: '文本',
      label: '文本生成',
      colorClass: makeTagColorClasses('blue'),
      icon: IconMessage,
    },
    // ...
  }
  ```

### 问题 2.3

- **位置**：`web-app/src/routes/marketplace/index.tsx`（第 312–321 行、第 374–384 行）
- **严重程度**：P2
- **问题描述**："清除筛选"按钮在 Active filters bar 和 Filters panel 中各出现一次，文案和图标完全一致，但样式略有不同（一个是 `variant="ghost" size="sm" className="h-6 text-xs"`，另一个是 `variant="ghost" size="sm" className="text-muted-foreground"`）。
- **修复建议**：提取为 `ClearFiltersButton` 组件或统一样式后复用。

---

## 3. Magic Number

### 问题 3.1

- **位置**：`web-app/src/components/marketplace/ModelCard.tsx`（第 129 行）
- **严重程度**：P1
- **问题描述**：`model.tasks?.slice(0, 2)` 中的 `2` 是 Magic Number，语义为"底部任务标签最大显示数量"，但没有命名常量，无法通过修改一处配置调整。
- **修复建议**：提取为命名常量 `MAX_TASK_TAGS = 2`。
- **修复后的代码片段**：
  ```tsx
  const MAX_TASK_TAGS = 2
  // ...
  {model.tasks?.slice(0, MAX_TASK_TAGS).map((task) => (...))}
  ```

### 问题 3.2

- **位置**：`web-app/src/components/marketplace/ModelCard.tsx`（第 27、62 行）
- **严重程度**：P2
- **问题描述**：`min-h-[140px]` 在骨架屏和真实卡片中各硬编码一次，语义为卡片最小高度。
- **修复建议**：提取为 `MODEL_CARD_MIN_HEIGHT = 140` 或 Tailwind 扩展类。

### 问题 3.3

- **位置**：`web-app/src/components/marketplace/ModelCard.tsx`（第 126、132、138 行）
- **严重程度**：P2
- **问题描述**：`max-w-[140px]`、`max-w-[100px]`、`max-w-[120px]` 等 Magic Number 没有说明设计意图。
- **修复建议**：提取为语义化常量或 Tailwind 配置。
  ```tsx
  const META_MAX_WIDTHS = {
    namespace: 140,
    task: 100,
    license: 120,
  }
  ```

### 问题 3.4

- **位置**：`web-app/src/routes/marketplace/index.tsx`（第 68 行）
- **严重程度**：P2
- **问题描述**：防抖延迟 `400` 毫秒是 Magic Number，缺乏语义。
- **修复建议**：提取为 `SEARCH_DEBOUNCE_MS = 400`。

### 问题 3.5

- **位置**：`web-app/src/routes/marketplace/index.tsx`（第 81 行）
- **严重程度**：P2
- **问题描述**：`IntersectionObserver` 的 `threshold: 0.1` 是 Magic Number。
- **修复建议**：提取为 `INFINITE_SCROLL_THRESHOLD = 0.1`。

### 问题 3.6

- **位置**：`web-app/src/routes/marketplace/index.tsx`（第 354、371 行）
- **严重程度**：P2
- **问题描述**：输入框宽度 `w-28`、`w-32` 是 Magic Tailwind 类，语义为"自定义标签输入框宽度"和"许可证输入框宽度"。
- **修复建议**：提取为常量或使用统一的表单输入组件。

### 问题 3.7

- **位置**：`web-app/src/routes/marketplace/index.tsx`（第 392 行）
- **严重程度**：P2
- **问题描述**：`w-[400px]` 是弹窗宽度 Magic Number，未使用设计系统中预设的弹窗尺寸。
- **修复建议**：使用设计系统预设尺寸，如 `max-w-md`（448px）或自定义 `DIALOG_WIDTH = 400`。

---

## 4. 错误处理

### 问题 4.1

- **位置**：`web-app/src/hooks/useModelScope.ts`（第 39–43 行）
- **严重程度**：P1
- **问题描述**：加载 Token 时 `.catch(() => setTokenState(null))` 静默吞掉所有错误。如果 Rust 侧命令不存在或发生 I/O 错误，用户和开发者都无法感知。
- **修复建议**：至少记录警告日志，或在开发模式下抛出。
  ```ts
  useEffect(() => {
    invoke<string | null>('get_modelscope_token')
      .then((t) => setTokenState(t))
      .catch((err) => {
        console.warn('[useModelScope] Failed to load token:', err)
        setTokenState(null)
      })
  }, [])
  ```

### 问题 4.2

- **位置**：`web-app/src/hooks/useModelScope.ts`（第 95–109 行）
- **严重程度**：P0
- **问题描述**：`useEffect` 中通过 `// eslint-disable-next-line react-hooks/exhaustive-deps` 刻意忽略 `fetchModels` 和 `params.page_number` 的依赖。这会导致：
  1. 如果 `fetchModels` 的闭包逻辑发生变化（如内部使用了新的 ref），此 effect 不会重新执行。
  2. `params` 对象本身变化时也会误触发（虽然通过字段展开避免了）。
  3. 这是明显的技术债务标记。
- **修复建议**：重构为稳定引用的 `fetchModels`（使用 `useRef` 保存最新 params），或改用 `useCallback` + 将依赖完整写入数组。最简洁的方式是将 `fetchModels` 从依赖中解耦：
  ```ts
  const fetchModelsRef = useRef(fetchModels)
  fetchModelsRef.current = fetchModels

  useEffect(() => {
    fetchModelsRef.current({ ...params, page_number: 1 })
  }, [params.search, params.owner, params.sort, /* ... */ token])
  ```

### 问题 4.3

- **位置**：`web-app/src/routes/marketplace/index.tsx`（第 176–181 行）
- **严重程度**：P1
- **问题描述**：`handleSaveToken` 未处理 `setToken(tokenInput)` 的 Promise rejection。如果 Rust 命令失败，弹窗会错误地关闭，且 Token 状态不会更新，用户无法得到错误反馈。
- **修复建议**：添加 `.catch` 并展示错误提示。
  ```ts
  const handleSaveToken = useCallback(() => {
    setToken(tokenInput)
      .then(() => {
        setShowTokenDialog(false)
        setTokenInput('')
      })
      .catch((err) => {
        toast.error(`保存 Token 失败: ${err.message}`)
      })
  }, [tokenInput, setToken])
  ```

### 问题 4.4

- **位置**：`web-app/src/hooks/useModelScope.ts`（第 54–92 行）
- **严重程度**：P1
- **问题描述**：`fetchModels` 没有设置请求超时。如果 Rust 侧 `invoke` 挂起，UI 将永远处于 `loading: true` 状态。
- **修复建议**：使用 `AbortController` + `setTimeout` 实现超时，或确保 Rust 侧有超时机制。前端至少应在 `finally` 中保证 `loading` 被重置（当前仅在 `catch` 中重置，若 `invoke` 永远挂起则不执行）。

### 问题 4.5

- **位置**：`web-app/src/components/marketplace/ModelCard.tsx`（第 54–56 行）
- **严重程度**：P2
- **问题描述**：`model.id.split('/')` 被连续调用两次，且未处理 `id` 中不含 `/` 的边界情况。如果 `id` 格式异常（如 `"qwen"`），`namespace` 会等于 `"qwen"`，`displayName` 会通过 `pop()` 也等于 `"qwen"`，行为尚可；但如果 `id` 为空字符串（理论上不应出现），`pop()` 返回 `undefined`，`displayName` 回退到 `model.id` 即空字符串，会导致卡片标题为空。
- **修复建议**：统一解析逻辑并添加防御性处理。
  ```ts
  const [namespace, name] = model.id.includes('/')
    ? model.id.split('/', 2)
    : ['', model.id]
  const displayName = model.display_name || name || model.id || 'Unnamed Model'
  ```

---

## 5. 硬编码文本

### 问题 5.1

- **位置**：`web-app/src/routes/marketplace/index.tsx`（第 185 行）
- **严重程度**：P1
- **问题描述**：排序下拉默认文案 `'排序'` 硬编码中文，未使用 i18n。
- **修复建议**：添加翻译键 `hub:sortLabel`。
  ```tsx
  const sortLabel =
    MODELSCOPE_SORT_OPTIONS.find((o) => o.value === params.sort)?.label ??
    t('hub:sortLabel')
  ```

### 问题 5.2

- **位置**：`web-app/src/routes/marketplace/index.tsx`（第 236–241、280、295、307、318、328、335、342、349、358、365、382、393–404、417、420、432、436、464、474、482–483、513 行）
- **严重程度**：P0
- **问题描述**：页面中存在大量硬编码中文文本，包括但不限于：
  - Token 状态按钮：`'Token 已配置'` / `'Token 未配置'` / title 提示
  - 筛选按钮：`'筛选'` + 计数徽标
  - 活跃筛选栏：`'筛选:'`、`'移除筛选'`、`'清除筛选'`
  - 筛选面板标签：`'任务'`、`'框架'`、`'标签'`、`'许可证'`、`'模型类型'`、`'部署'`
  - 筛选输入占位符：`'如: llm, gguf'`、`'如: apache-2.0'`
  - Token 弹窗标题与描述
  - 弹窗按钮：`'取消'`、`'保存'`
  - 统计栏：`"共 {x} 个模型"`、`"已加载 {x} 个"`、`"按\"{x}\"排序"`
  - 错误/空态：`"加载失败"`、`"重试"`、`"没有找到匹配的模型"`、`"暂无模型数据"`
  - 底部：`"已加载全部 {x} 个模型"`
  - `FilterSelect` 默认值：`'全部'`
- **修复建议**：所有用户可见文本必须通过 `t('hub:xxx')` 或 `t('common:xxx')` 走 i18n。已在 `locales/zh-CN/hub.json` 和 `locales/en/hub.json` 中存在部分键，但 marketplace 页面新增的大量文本均未补充翻译。

### 问题 5.3

- **位置**：`web-app/src/components/marketplace/tagConstants.ts`（第 203、220、235、246 行）
- **严重程度**：P1
- **问题描述**：所有 `tooltip` 文本均为硬编码中文，且直接拼接在运行时，无法被 i18n 系统提取。
- **修复建议**：tooltip 文案应支持 i18n 键，或至少通过翻译函数传入参数生成。
  ```ts
  tooltip: t('hub:filterByTaskTooltip', { task: config.label }),
  ```

### 问题 5.4

- **位置**：`web-app/src/services/modelscope/types.ts`（第 66–97 行）
- **严重程度**：P1
- **问题描述**：`MODELSCOPE_SORT_OPTIONS`、`MODELSCOPE_TASK_OPTIONS`、`MODELSCOPE_LIBRARY_OPTIONS` 中的 `label` 全部为硬编码中文。虽然 types 文件通常只定义数据结构，但这些常量直接被 UI 消费，导致 i18n 无法覆盖。
- **修复建议**：将 UI 常量迁移至 `constants/modelscope.ts`，label 改为 i18n 键，在渲染时通过 `t(option.labelKey)` 解析。
  ```ts
  export const MODELSCOPE_SORT_OPTIONS = [
    { value: 'downloads', labelKey: 'hub:sortMostDownloaded' },
    // ...
  ] as const
  ```

### 问题 5.5

- **位置**：`web-app/src/components/marketplace/ModelCard.tsx`（第 127 行）
- **严重程度**：P2
- **问题描述**：`"By {namespace}"` 为英文硬编码，未使用 i18n。与项目中文本地化目标不符。
- **修复建议**：
  ```tsx
  <span>{t('hub:byAuthor', { namespace })}</span>
  // zh-CN: "由 {namespace}"
  // en: "By {namespace}"
  ```

---

## 6. 样式一致性

### 问题 6.1

- **位置**：`web-app/src/components/marketplace/ModelCard.tsx`、`ModelTagStrip.tsx`、`tagConstants.ts`
- **严重程度**：P1
- **问题描述**：颜色系统未走设计系统 Token，直接硬编码 Tailwind 工具类（如 `bg-blue-500/20`、`text-green-600`、`border-amber-500/30` 等）。这导致：
  1. 主题切换（如新增主题）时无法自动适配。
  2. 颜色语义散落在 20+ 个配置对象中，无法统一管理。
- **修复建议**：在 Tailwind 配置或 CSS 变量中定义 `tag-*` 语义化颜色，如 `bg-tag-task text-tag-task-foreground`。

### 问题 6.2

- **位置**：`web-app/src/routes/marketplace/index.tsx`（多处）
- **严重程度**：P2
- **问题描述**：shadow 使用不一致：`shadow-sm`（卡片）、无 shadow（骨架屏）、`hover:shadow-md`（卡片 hover）。padding 也存在 `p-4`（内容区）、`px-4 py-2`（filter bar）、`px-4 py-3`（filter panel）等多种变体，缺乏统一的设计系统规范。
- **修复建议**：定义卡片、面板、按钮等基础组件的统一样式 Token，如 `--card-padding: 1rem`、`--panel-padding: 0.75rem 1rem`。

### 问题 6.3

- **位置**：`web-app/src/components/marketplace/ModelCard.tsx`、`marketplace/index.tsx`
- **严重程度**：P2
- **问题描述**：字体大小混用：`text-[10px]`、`text-[11px]`、`text-xs`、`text-sm`、`text-lg` 等多种尺寸，且 `[10px]`、`[11px]` 等任意值未纳入设计系统。
- **修复建议**：将所有标签、元数据字体统一为设计系统预设尺寸（如 `text-2xs`、`text-xs`、`text-sm`）。

### 问题 6.4

- **位置**：`web-app/src/components/marketplace/ModelCard.tsx`（第 27、62 行）
- **严重程度**：P2
- **问题描述**：骨架屏缺少 `overflow-hidden` 类，而真实卡片有（第 62 行）。这可能导致骨架屏在 hover 或特定宽度下出现布局差异。
- **修复建议**：统一外层容器类名。

---

## 7. 文件组织

### 问题 7.1

- **位置**：`web-app/src/routes/marketplace/index.tsx`（第 526–554 行）
- **严重程度**：P1
- **问题描述**：`FilterSelect` 组件定义在页面文件底部，违反了"一个文件一个组件"的约定。该组件可被其他筛选页面复用（如 settings/modelscope）。
- **修复建议**：提取至 `web-app/src/components/marketplace/FilterSelect.tsx`。

### 问题 7.2

- **位置**：`web-app/src/components/marketplace/tagConstants.ts`
- **严重程度**：P1
- **问题描述**：文件名 `tagConstants.ts` 暗示只包含常量，但实际导出了 `TagItem` 接口和 `getModelTags` 函数。命名与实际内容不符。
- **修复建议**：重命名为 `modelTags.ts` 或拆分为 `modelTagTypes.ts` + `modelTagUtils.ts`。

### 问题 7.3

- **位置**：`web-app/src/services/modelscope/types.ts`（第 66–97 行）
- **严重程度**：P2
- **问题描述**：类型文件（`types.ts`）中混入了 UI 常量（`MODELSCOPE_SORT_OPTIONS` 等）。类型定义应纯粹描述数据结构，UI 常量应放在 `constants/` 或组件附近。
- **修复建议**：将选项常量迁移至 `web-app/src/constants/modelscope.ts` 或 `web-app/src/services/modelscope/constants.ts`。

---

## 8. 注释质量

### 问题 8.1

- **位置**：`web-app/src/routes/marketplace/index.tsx`（第 64–70 行、第 72–85 行）
- **严重程度**：P2
- **问题描述**：防抖（debounce）和无限滚动（IntersectionObserver）是核心交互逻辑，但缺少注释说明其工作原理、清理时机和阈值含义。
- **修复建议**：添加 JSDoc 或行内注释。
  ```ts
  // Debounce search input by 400ms to avoid firing API on every keystroke.
  // The timeout is cleaned up on unmount or when searchValue changes.
  ```

### 问题 8.2

- **位置**：`web-app/src/hooks/useModelScope.ts`（第 95–109 行）
- **严重程度**：P2
- **问题描述**：`eslint-disable` 上方没有解释为什么需要禁用规则，下一个维护者无法理解这是刻意设计还是临时 hack。
- **修复建议**：
  ```ts
  // We intentionally omit `fetchModels` and `params.page_number` from deps:
  // `fetchModels` is recreated on every `params` change, which would cause
  // an infinite loop. We only want to reset to page 1 when filter/sort changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ```

---

## 9. TODO / FIXME

### 问题 9.1

- **位置**：`web-app/src/routes/marketplace/index.tsx`（第 36 行）
- **严重程度**：P1
- **问题描述**：`createFileRoute(route.marketplace.index as any)` 使用 `as any` 规避了 TanStack Router 的严格类型检查。这是已知的技术债务，但没有 TODO/FIXME 标记。
- **修复建议**：添加 TODO 注释并跟进修复类型定义。
  ```ts
  // TODO: fix route type inference for marketplace.index
  export const Route = createFileRoute(route.marketplace.index as any)({...})
  ```

### 问题 9.2

- **位置**：`web-app/src/hooks/useModelScope.ts`（第 97 行）
- **严重程度**：P0
- **问题描述**：`// eslint-disable-next-line react-hooks/exhaustive-deps` 本质上是一个隐含的 FIXME。当前实现存在潜在的闭包过期风险，且不符合 React 最佳实践。
- **修复建议**：标记为 FIXME 并重构（参见问题 4.2）。

### 问题 9.3

- **位置**：`web-app/src/routes/marketplace/index.tsx`（第 390–425 行）
- **严重程度**：P1
- **问题描述**：Token 配置弹窗使用手写的 `fixed inset-0 z-50 flex ...` 实现，未复用项目中已有的 `Dialog` / `Modal` 组件（如 `@/components/ui/dialog`）。这是重复造轮子，且 accessibility（焦点捕获、ESC 关闭、ARIA 属性）不完善。
- **修复建议**：替换为标准 Dialog 组件。
  ```tsx
  <Dialog open={showTokenDialog} onOpenChange={setShowTokenDialog}>
    <DialogContent>
      <DialogHeader>配置 ModelScope 访问令牌</DialogHeader>
      ...
    </DialogContent>
  </Dialog>
  ```

---

## 附：严重程度定义

| 级别 | 含义 | 修复优先级 |
|------|------|-----------|
| P0 | 存在运行时 bug、类型安全风险或明显的技术债务，必须立即修复 | 最高 |
| P1 | 影响可维护性、可扩展性或违反核心规范，应在下个迭代修复 | 高 |
| P2 | 代码异味或轻微不一致，可在重构时顺手修复 | 中 |

---

## 附：统计汇总

| 审查维度 | P0 | P1 | P2 |
|---------|----|----|----|
| 组件职责 | 0 | 3 | 0 |
| 代码重复 | 0 | 2 | 1 |
| Magic Number | 0 | 1 | 5 |
| 错误处理 | 1 | 3 | 1 |
| 硬编码文本 | 1 | 2 | 1 |
| 样式一致性 | 0 | 1 | 3 |
| 文件组织 | 0 | 2 | 1 |
| 注释质量 | 0 | 0 | 2 |
| TODO/FIXME | 1 | 2 | 0 |
| **合计** | **3** | **16** | **15** |
