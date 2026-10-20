import type { PropsWithChildren } from 'react'
import { ChevronDown } from 'lucide-react'

// A stack of collapsible rows in one box: 1px line, 12px corners, rows split
// by hairlines. Each row is a native <details> (works without JavaScript and
// with the keyboard); its title is doc-body Medium with a chevron on the
// right that turns when open. Rows start collapsed (docs pages leave `open`
// off, so readers expand the one they need). In dark mode the box takes the
// surface fill, like the other cards.
//
//   <Accordions>
//     <Accordion title="macOS">…</Accordion>
//     <Accordion title="Windows">…</Accordion>
//   </Accordions>

export function Accordions({ children }: PropsWithChildren) {
  return (
    <div className="jan-accordions mt-6 overflow-hidden rounded-xl border border-line dark:bg-surface">
      {children}
    </div>
  )
}

export function Accordion({ title, open, children }: { title: string; open?: boolean } & PropsWithChildren) {
  return (
    <details open={open} className="group !m-0 border-line [&+&]:border-t">
      <summary className="focus-ring flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-doc-body font-medium text-ink [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown
          aria-hidden
          className="size-4 shrink-0 text-ink/60 transition-transform duration-200 ease-jan group-open:rotate-180"
        />
      </summary>
      <div className="px-5 pb-5 [&>:first-child]:!mt-0 [&>:last-child]:!mb-0">{children}</div>
    </details>
  )
}
