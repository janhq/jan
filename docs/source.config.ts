import { defineConfig, defineDocs } from 'fumadocs-mdx/config'
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { visit } from 'unist-util-visit'
import { z } from 'zod'

// ```mermaid fences -> <Mermaid chart="..." /> (rendered client-side).
// biome-ignore lint/suspicious/noExplicitAny: mdast types are loose here
const remarkMermaid = () => (tree: any) => {
  // biome-ignore lint/suspicious/noExplicitAny: mdast node
  visit(tree, 'code', (node: any, index: number | undefined, parent: any) => {
    if (node.lang !== 'mermaid' || !parent || index === undefined) return
    parent.children[index] = {
      type: 'mdxJsxFlowElement',
      name: 'Mermaid',
      attributes: [{ type: 'mdxJsxAttribute', name: 'chart', value: node.value }],
      children: [],
    }
  })
}

// Headings inside <Tabs> were not in the old "On This Page" list (Nextra only
// rendered the active panel). Mark them [!toc] so Fumadocs skips them.
// biome-ignore lint/suspicious/noExplicitAny: mdast types are loose here
const remarkTabsNoToc = () => (tree: any) => {
  // biome-ignore lint/suspicious/noExplicitAny: mdast node
  visit(tree, (node: any) => {
    if (node.type !== 'mdxJsxFlowElement' || node.name !== 'Tabs') return
    // biome-ignore lint/suspicious/noExplicitAny: mdast node
    visit(node, 'heading', (h: any) => {
      const last = h.children[h.children.length - 1]
      if (last?.type === 'text') last.value = `${last.value} [!toc]`
      else h.children.push({ type: 'text', value: ' [!toc]' })
    })
  })
}

export const docs = defineDocs({
  dir: 'content',
  docs: {
    schema: pageSchema.extend({
      // Sidebar label from the old _meta.json, when it differs from the title.
      sidebarTitle: z.string().optional(),
      // Carried over from the Nextra frontmatter.
      keywords: z.array(z.string()).optional(),
      noindex: z.boolean().optional(),
      ogImage: z.string().optional(),
      // 'standalone': no sidebar, TOC or breadcrumb (Nextra `type: "page"`).
      layout: z.enum(['docs', 'standalone']).optional(),
    }),
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
})

export default defineConfig({
  mdxOptions: {
    // Dark code blocks, like the old Code Hike `dark-plus` theme.
    rehypeCodeOptions: {
      themes: { light: 'dark-plus', dark: 'dark-plus' },
    },
    remarkPlugins: (v) => [remarkMath, remarkMermaid, remarkTabsNoToc, ...v],
    rehypePlugins: (v) => [rehypeKatex, ...v],
  },
})
