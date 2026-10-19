import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { DocsBody, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page'
import { TOCPopover, TOCProvider } from 'fumadocs-ui/layouts/docs/page/slots/toc'
import { baseOptions } from '@/lib/layout.shared'
import { createRelativeLink } from 'fumadocs-ui/mdx'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getMDXComponents } from '@/components/mdx'
import { NextraToc } from '@/components/nextra-toc'
import { NavLinks } from '@/components/nav-links'
import { PageSection } from '@/components/page-section'
import { source } from '@/lib/source'
import { defaultOgImage, isNightly, siteName } from '@/lib/shared'
import { CopyPage } from '@/components/copy-page'

type Props = { params: Promise<{ slug: string[] }> }

export default async function Page(props: Props) {
  const { slug } = await props.params
  const page = source.getPage(slug)
  if (!page) notFound()

  const MDX = page.data.body
  const tocExclude = new Set(page.data.tocExclude ?? [])
  const toc = page.data.toc.filter((item) => !tocExclude.has(item.url))

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
      // Jan Desktop / Jan Agent are root folders, so the sidebar shows one at
      // a time. The navbar tabs switch between them, so no sidebar switcher.
      tabs={false}
      sidebar={{ defaultOpenLevel: 0, collapsible: false }}
    >
    <DocsPage
      toc={toc}
      full={page.data.full}
      breadcrumb={{ enabled: false }}
      // "On This Page" is a port of Nextra's TOC (one active heading at a time).
      tableOfContent={{ single: true }}
      slots={{ toc: { provider: TOCProvider, main: NextraToc, popover: TOCPopover } }}
      // Prev/next as on jan.ai/docs (title + arrow), not Fumadocs' cards.
      footer={{ enabled: false }}
    >
      {/* One block, so the section label sits right on the title (the page
          column spaces its children 16px apart). */}
      <div>
        <PageSection />
        <div className="flex items-start justify-between gap-4">
          <DocsTitle className="mt-0">{page.data.title}</DocsTitle>
          {/* In the right sidebar from xl; here below that. Nudged down to sit
              level with the title's first line. */}
          <CopyPage className="mt-2 xl:hidden" />
        </div>
      </div>
      <DocsBody>
        {body}
      </DocsBody>
      <NavLinks />
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
    robots: isNightly || noindex ? { index: false, follow: false } : undefined,
    alternates: { canonical: page.url },
    // Page-level openGraph replaces the root one, so repeat site-wide fields.
    openGraph: { type: 'article', siteName, title, description, url: page.url, images: [image] },
  }
}
