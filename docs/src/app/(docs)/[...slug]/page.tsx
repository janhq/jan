import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  EditOnGitHub,
  MarkdownCopyButton,
} from 'fumadocs-ui/layouts/docs/page'
import { createRelativeLink } from 'fumadocs-ui/mdx'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getMDXComponents } from '@/components/mdx'
import { source } from '@/lib/source'
import { defaultOgImage, editUrl, pageMarkdownUrl } from '@/lib/shared'

type Props = { params: Promise<{ slug: string[] }> }

export default async function Page(props: Props) {
  const { slug } = await props.params
  const page = source.getPage(slug)
  if (!page) notFound()

  const MDX = page.data.body

  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      // Old site: full path breadcrumb (Docs > Jan Desktop > Install > Linux).
      breadcrumb={{ includeRoot: true, includePage: true }}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      {page.data.description && (
        <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
      )}
      <div className="flex flex-row items-center gap-2 border-b pb-6">
        <MarkdownCopyButton markdownUrl={pageMarkdownUrl(page.slugs)} />
        <EditOnGitHub href={editUrl(page.path)} />
      </div>
      <DocsBody>
        <MDX components={getMDXComponents({ a: createRelativeLink(source, page) })} />
      </DocsBody>
    </DocsPage>
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
