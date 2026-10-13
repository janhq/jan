import { notFound } from 'next/navigation'
import { docsLlms, source } from '@/lib/source'

export const revalidate = false

// /llms.mdx/<page slugs>/content.md -> raw Markdown of that page. Backs the
// "Copy Markdown" button; a static file per page in the export.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  const { slug } = await params
  const page = source.getPage(slug.slice(0, -1))
  if (!page) notFound()

  return new Response(await docsLlms.page(page), {
    headers: { 'Content-Type': 'text/markdown' },
  })
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({ slug: [...page.slugs, 'content.md'] }))
}
