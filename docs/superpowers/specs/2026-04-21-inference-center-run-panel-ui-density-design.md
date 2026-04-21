# 推理中心运行面板 UI 密度优化设计

## 目标

在不改变任何功能、参数字段、校验逻辑、提交 payload 和可见性规则的前提下，优化推理中心运行面板的视觉设计，使其更像高密度运行控制台，而不是纵向堆叠的普通表单。

本次只调整 UI 表现，不调整交互语义：

- 仍然先选 `model`
- 未选模型时，参数区和启动按钮仍然完整显示
- 参数名继续严格保持 Ollama 原始字段名
- `onSubmit`、`buildOllamaRunPayload`、Rust request 结构不变

## 视觉方向

采用“高密度控制台”方向：

- 短参数使用 2 到 4 列混排栅格，不再默认一行一个字段
- 长文本/长结构参数继续独占宽行，避免可用性下降
- 通过小型圆圈问号图标承载参数解释，鼠标悬浮显示 tooltip
- 常用区与高级区共用一套控制台式视觉语言，避免展开高级后像切到另一张表单

## 布局规则

### 1. 顶部结构

运行面板保留为独立卡片，但强化“运行台”感：

- 标题区显示“运行面板”及辅助说明
- 右上角保留本次启动临时生效的状态提示
- `model` 与 `keep_alive` 放在顶部第一行，形成主操作区

### 2. 常用参数区

常用短参数进入高密度栅格布局：

- `num_ctx`
- `num_predict`
- `temperature`
- `top_k`
- `top_p`
- `min_p`

这些字段优先使用 4 列布局，在中等宽度下自动降为 2 列。

`stop` 保持宽字段，不压缩成小输入框。

### 3. 高级参数区

高级区展开后继续使用混排规则：

- `system`、`template`、`context`、`format` 使用宽字段或整行 textarea/json 输入区
- `raw`、`truncate`、`shift`、`logprobs`、`top_logprobs`
- `num_keep`、`seed`、`typical_p`、`repeat_last_n`
- `repeat_penalty`、`presence_penalty`、`frequency_penalty`
- `num_batch`、`num_gpu`、`main_gpu`、`use_mmap`、`num_thread`

其中布尔/数字型短参数优先进入多列栅格；结构性或多行内容参数保持宽字段。

## 参数说明方式

每个参数 label 右侧增加一个小型圆圈问号图标。

tooltip 内容规则：

- 第一行说明参数作用
- 第二行给出常见取值语义或默认理解
- 如有必要，补一句对显存、速度或采样风格的影响

tooltip 必须短，不应替代完整文档，不允许塞入长段说明。

## 组件实现约束

为了确保“只改 UI 不改功能”，实现时遵守以下约束：

- 不改 `ollamaRunSchema.ts` 的字段集合、字段归类和 payload 生成逻辑
- 不改 `OllamaRunPanel` 的提交条件、异常处理和状态控制
- 不改 `ModelCombobox` 行为
- 不改任何 Rust 端字段定义和请求结构
- 不新增参数，不删除参数，不修改字段名

允许的改动范围仅包括：

- `OllamaRunPanel.tsx` 的布局结构
- 参数 label/说明渲染层
- tooltip 组件接入
- 样式 class 和分组容器
- 与新 UI 对应的前端测试断言

## 验证要求

实现完成后至少验证：

- 未选模型时，参数仍然全部可见，启动按钮仍不可用
- 高级区仍可展开，原始字段名仍可见
- 提交 payload 与当前版本一致
- JSON 校验错误提示仍保持中文
- tooltip 存在且不影响字段可访问性
- 在桌面宽度下短参数能并排显示，在较窄宽度下自动换列

