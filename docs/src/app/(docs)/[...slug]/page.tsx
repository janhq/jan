import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { DocsBody, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page'
import { baseOptions } from '@/lib/layout.shared'
import { createRelativeLink } from 'fumadocs-ui/mdx'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getMDXComponents } from '@/components/mdx'
import { TocFooter } from '@/components/toc-footer'
import { Breadcrumb } from '@/components/breadcrumb'
import { source } from '@/lib/source'
import { defaultOgImage, editUrl, pageMarkdownUrl } from '@/lib/shared'

type Props = { params: Promise<{ slug: string[] }> }

export default async function Page(props: Props) {
  const { slug } = await props.params
  const page = source.getPage(slug)
  if (!page) notFound()

  const MDX = page.data.body
  const footer = (
    <TocFooter
      title={page.data.title}
      editUrl={editUrl(page.path)}
      markdownUrl={pageMarkdownUrl(page.slugs)}
    />
  )

  const body = <MDX components={getMDXComponents({ a: createRelativeLink(source, page) })} />

  // `layout: standalone` (Nextra `type: "page"`, e.g. the privacy policy):
  // full-width page, no sidebar, breadcrumb or table of contents.
  if (page.data.layout === 'standalone') {
    return (
      <article id="nd-page" className="jan-container jan-standalone py-8">
        <div className="mx-auto max-w-[832px]">
          <h1>{page.data.title}</h1>
          <div className="prose">{body}</div>
        </div>
      </article>
    )
  }

  // Same page top as jan.ai/docs: breadcrumb, H1, then the body. The
  // frontmatter description is metadata only (it was never shown on the page).
  return (
    <DocsLayout
      tree={source.getPageTree()}
      {...baseOptions()}
      // Jan Desktop / Jan Agent are root folders -> sidebar tab switcher.
      tabMode="auto"
      sidebar={{ defaultOpenLevel: 0, collapsible: false }}
    >
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      breadcrumb={{ enabled: false }}
      // One active heading at a time, like Nextra.
      tableOfContent={{ footer, single: true }}
      tableOfContentPopover={{ footer }}
      footer={{ enabled: true }}
    >
      <Breadcrumb />
      <DocsTitle className="mt-0">{page.data.title}</DocsTitle>
      <DocsBody>
        {body}
      </DocsBody>
    </DocsPage>
    </DocsLayout>
  )
}

export function generateStaticParams() {
  // The root page (/) is served by app/(home)/page.tsx.
  return source.generateParams().filter((p) => p.slug.length > 0)
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { slug } = await props.params
  const page = source.getPage(slug)
  if (!page) notFound()

  const { title, description, keywords, noindex, ogImage } = page.data
  const image = ogImage ? `/${ogImage.replace(/^\//, '')}` : defaultOgImage

  return {
    title,
    description,
    keywords,
    robots: noindex ? { index: false, follow: false } : undefined,
    alternates: { canonical: page.url },
    openGraph: { title, description, url: page.url, images: [image] },
  }
}
