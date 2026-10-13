import type { Metadata } from 'next'
import { DocsHome } from '@/components/docs-home'

export const metadata: Metadata = {
  title: { absolute: 'Jan Docs' },
  description: 'References for Jan Desktop and Jan Agent.',
  alternates: { canonical: '/' },
}

export default function HomePage() {
  return <DocsHome />
}
