import { defineConfig, defineDocs } from 'fumadocs-mdx/config'
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { z } from 'zod'

export const docs = defineDocs({
  dir: 'content',
  docs: {
    schema: pageSchema.extend({
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
    remarkPlugins: (v) => [remarkMath, ...v],
    rehypePlugins: (v) => [rehypeKatex, ...v],
  },
})
