'use client'
import { ArrowUp } from 'lucide-react'

// Bottom of the "On This Page" column, as on the old site: feedback, edit,
// scroll to top. Copy-Markdown lives here too (new, small).
export function TocFooter({
  title,
  editUrl,
  markdownUrl,
}: {
  title: string
  editUrl: string
  markdownUrl: string
}) {
  const feedback = `https://github.com/janhq/jan/issues/new?title=${encodeURIComponent(
    `Feedback for “${title}”`
  )}&labels=feedback`
  const link = 'text-xs font-medium text-[#6b7280] hover:text-[#111827] transition-colors'
  return (
    <div className="jan-toc-footer mt-8 flex flex-col items-start gap-2 border-t border-[#e5e7eb] pt-8">
      <a href={feedback} target="_blank" rel="noreferrer" className={link}>
        Question? Give us feedback →
      </a>
      <a href={editUrl} target="_blank" rel="noreferrer" className={link}>
        Edit this page on GitHub →
      </a>
      <a href={markdownUrl} target="_blank" rel="noreferrer" className={link}>
        View as Markdown →
      </a>
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        className={`${link} inline-flex items-center gap-1.5`}
      >
        Scroll to top
        <ArrowUp className="size-3.5 rounded-full border border-current p-px" />
      </button>
    </div>
  )
}
