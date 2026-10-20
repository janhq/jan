import { ReactNode } from 'react'

export default function OpenInJanButton({
  href,
  children,
}: {
  href: string
  children?: ReactNode
}) {
  return (
    <a
      href={href}
      className="not-prose mt-2 inline-flex items-center gap-2 rounded-xl border-2 border-black bg-black px-5 py-2.5 text-[15px] font-semibold text-white no-underline transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0px_4px_0px_0px_rgba(0,0,0,1)] dark:border-white dark:bg-white dark:text-black dark:hover:shadow-[0px_4px_0px_0px_rgba(255,255,255,1)]"
    >
      {children ?? 'Open in Jan'}
    </a>
  )
}
