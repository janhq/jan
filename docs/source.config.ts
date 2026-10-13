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
    remarkPlugins: (v) => [remarkMath, remarkMermaid, ...v],
    rehypePlugins: (v) => [rehypeKatex, ...v],
  },
})
