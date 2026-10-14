import { defineConfig, defineDocs } from 'fumadocs-mdx/config'
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema'
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

// Nextra 2's rule (remark-headings): a heading that is a direct child of
// <Tabs.Tab> is left out of "On This Page". Headings nested deeper (e.g. in
// <Steps> inside a tab) stay. Record the ids so the page drops them.
// biome-ignore lint/suspicious/noExplicitAny: mdast types are loose here
const remarkTabsNoToc = () => (tree: any, file: any) => {
  const ids: string[] = []
  // biome-ignore lint/suspicious/noExplicitAny: mdast node
  visit(tree, (node: any) => {
    if (node.type !== 'mdxJsxFlowElement' || (node.name !== 'Tabs.Tab' && node.name !== 'Tab')) return
    for (const child of node.children ?? []) {
      const id = child.type === 'heading' && child.data?.hProperties?.id
      if (id) ids.push(`#${id}`)
    }
  })
  file.data.frontmatter ??= {}
  file.data.frontmatter.tocExclude = ids
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
      // Set by remarkTabsNoToc, not by authors.
      tocExclude: z.array(z.string()).optional(),
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
    remarkPlugins: (v) => [remarkMermaid, ...v, remarkTabsNoToc],
  },
})
