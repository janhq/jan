import type { PropsWithChildren } from 'react'

export function FAQBox({ title, children }: { title: string } & PropsWithChildren) {
  return (
    <details open className="mt-4 rounded-lg bg-neutral-50 p-2 last-of-type:mb-0">
      <summary>
        <strong className="ml-2 text-lg">{title}</strong>
      </summary>
      <div className="p-2">{children}</div>
    </details>
  )
}

export default FAQBox
