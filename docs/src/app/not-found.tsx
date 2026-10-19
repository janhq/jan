import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { SearchField } from '@/components/search-field'

export default function NotFound() {
  return (
    <div className="jan-container py-24 text-center">
      <h1 className="text-balance text-display-md text-ink">Page not found</h1>
      <p className="mt-4 text-tagline text-ink/60">
        This page doesn&apos;t exist or has moved. Try searching the docs.
      </p>
      <SearchField variant="hero" className="mx-auto mt-8 max-w-xl" />
      <Link
        href="/"
        className="focus-ring mt-8 inline-flex items-center gap-1.5 rounded-sm font-mono text-mono-link uppercase text-link transition-opacity duration-150 ease-jan hover:opacity-80"
      >
        Back to Jan Docs
        <ArrowRight className="size-3.5" />
      </Link>
    </div>
  )
}
