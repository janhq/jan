import type { PropsWithChildren } from 'react'

// A question with its answer, open by default: 1px line, 12px corners, the
// question in doc-h3.
export function FAQBox({ title, children }: { title: string } & PropsWithChildren) {
  return (
    <details open className="mt-4 rounded-xl border border-line px-5 py-4 dark:bg-surface last-of-type:mb-0">
      <summary className="cursor-pointer text-doc-h3 text-ink">{title}</summary>
      <div className="mt-2 [&>:first-child]:!mt-0">{children}</div>
    </details>
  )
}

export default FAQBox
