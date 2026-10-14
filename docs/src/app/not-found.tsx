/* eslint-disable @next/next/no-img-element */
import { SearchField } from '@/components/search-field'

export default function NotFound() {
  return (
    <div className="jan-container py-24 text-center">
      <img src="/assets/logo-jan.svg" alt="" className="mx-auto size-14" />
      <h1 className="mt-6 font-serif text-4xl font-semibold">Page not found</h1>
      <p className="mt-4 text-black/60">
        This page doesn&apos;t exist or has moved. Try searching the docs.
      </p>
      <SearchField variant="hero" className="mx-auto mt-8 max-w-xl" />
      <a href="/" className="mt-8 inline-block font-medium text-jan-blue hover:underline">
        Back to Jan Docs →
      </a>
    </div>
  )
}
