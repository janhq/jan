/**
 * 模型详情页 README 渲染器。
 * 与全局 RenderMarkdown 不同:模型 README 大量使用 HTML 标签,
 * 这里启用 rehype-raw 渲染 HTML,并配合 rehype-sanitize 白名单防注入。
 * 另用 rehype-github-alert 支持 GitHub 提示框语法(>[!NOTE] 等)、
 * rehype-katex 渲染数学公式。注意插件顺序:KaTeX 必须在 sanitize 之前,
 * 否则 math 节点会被 sanitize 降级为普通 <code>,公式无法渲染。
 */
import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkEmoji from 'remark-emoji'
import rehypeRaw from 'rehype-raw'
import rehypeKatex from 'rehype-katex'
import rehypeGithubAlert from 'rehype-github-alert'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { removeYamlFrontMatter } from '@/lib/models'

// 在默认白名单上放宽 README 常用排版标签(默认 schema 含表格/代码/链接等)
const README_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    img: [
      ...(defaultSchema.attributes?.img ?? []),
      ['src', 'alt', 'title', 'width', 'height', 'align', 'style'],
    ],
    // README 常用内联样式控制对齐/字号(rehype-sanitize 内置 GitHub 式 style 净化)
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      'align',
      'className',
      'style',
    ],
    span: [...(defaultSchema.attributes?.span ?? []), 'className', 'style'],
    p: [...(defaultSchema.attributes?.p ?? []), 'align', 'className', 'style'],
    a: [...(defaultSchema.attributes?.a ?? []), 'title'],
    table: [
      ...(defaultSchema.attributes?.table ?? []),
      'align',
      'cellpadding',
      'cellspacing',
      'style',
    ],
    td: [
      ...(defaultSchema.attributes?.td ?? []),
      'align',
      'colspan',
      'rowspan',
      'style',
    ],
    th: [
      ...(defaultSchema.attributes?.th ?? []),
      'align',
      'colspan',
      'rowspan',
      'style',
    ],
    // 视频/音频:README 嵌入式演示剪辑
    video: [
      ...(defaultSchema.attributes?.video ?? []),
      'src',
      'controls',
      'poster',
      'autoplay',
      'loop',
      'muted',
      'width',
      'height',
    ],
    audio: [
      ...(defaultSchema.attributes?.audio ?? []),
      'src',
      'controls',
      'loop',
      'muted',
    ],
    source: [...(defaultSchema.attributes?.source ?? []), 'src', 'type'],
    // GitHub 提示框(rehype-github-alert 输出 .markdown-alert / .octicon 图标)
    svg: [
      ...(defaultSchema.attributes?.svg ?? []),
      'className',
      'viewBox',
      'version',
      'width',
      'height',
      'aria-hidden',
      'style',
    ],
    path: [
      ...(defaultSchema.attributes?.path ?? []),
      'd',
      'fill-rule',
      'clip-rule',
    ],
    title: [...(defaultSchema.attributes?.title ?? []), 'className'],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: ['http', 'https', 'data', 'blob'],
  },
  // KaTeX 数学公式渲染产物(MathML + katex HTML 结构)
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'figure',
    'figcaption',
    'center',
    'details',
    'summary',
    'video',
    'audio',
    'source',
    'kbd',
    'samp',
    'var',
    'small',
    'sub',
    'sup',
    'mark',
    'bdo',
    'hr',
    'svg',
    'path',
    'title',
    'math',
    'annotation',
    'annotation-xml',
    'semantics',
    'mrow',
    'mi',
    'mo',
    'mn',
    'msup',
    'msub',
    'mfrac',
    'msqrt',
    'mtext',
    'mspace',
    'mroot',
  ],
}

function ModelReadmeInner({ content }: { content: string }) {
  if (!content) return null
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath, remarkEmoji]}
      rehypePlugins={[
        rehypeRaw,
        rehypeGithubAlert,
        // KaTeX 必须在 sanitize 之前:先把 math 节点转成 katex HTML,
        // sanitize 再按白名单过滤(放行了 span.className/math 等)。
        rehypeKatex,
        [rehypeSanitize, README_SCHEMA],
      ]}
      components={{
        a: ({ node, ...props }) => {
          // react-markdown passes the hast `node` prop; strip it before it
          // reaches the DOM anchor. Discarded on purpose (not an unused var).
          void node
          return <a {...props} target="_blank" rel="noopener noreferrer" />
        },
      }}
    >
      {/* 剥离 YAML frontmatter,避免元数据行裸露 */}
      {removeYamlFrontMatter(content)}
    </ReactMarkdown>
  )
}

export const ModelReadme = memo(ModelReadmeInner)
