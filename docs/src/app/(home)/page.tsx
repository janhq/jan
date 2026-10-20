import type { Metadata } from 'next'
import { DocsHome } from '@/components/docs-home'
import { defaultDescription, siteName } from '@/lib/shared'

export const metadata: Metadata = {
  title: { absolute: siteName },
  description: defaultDescription,
  alternates: { canonical: '/' },
}

export default function HomePage() {
  return <DocsHome />
}
