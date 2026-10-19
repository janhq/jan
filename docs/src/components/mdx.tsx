import defaultMdxComponents from 'fumadocs-ui/mdx'
import { ImageZoom } from 'fumadocs-ui/components/image-zoom'
import type { MDXComponents } from 'mdx/types'
import { Callout, Link, Steps, Tabs } from '@/components/nextra-compat'
import { DocCard, DocCards } from '@/components/doc-card'
import { DownloadButton } from '@/components/download-button'
import { FAQBox } from '@/components/faq-box'
import { Mermaid } from '@/components/mermaid'
import { CodeBlock } from '@/components/code-block'

// Components available in every MDX page without an import. Pages that still
// `import { Callout } from 'nextra/components'` were rewritten by
// scripts/migrate-content.mjs to drop those imports.
export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    img: (props) => <ImageZoom {...(props as React.ComponentProps<typeof ImageZoom>)} />,
    pre: CodeBlock,
    Callout,
    Steps,
    Tabs,
    Link,
    DocCard,
    DocCards,
    DownloadButton,
    FAQBox,
    Mermaid,
    ...components,
  } satisfies MDXComponents
}

export const useMDXComponents = getMDXComponents

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>
}
