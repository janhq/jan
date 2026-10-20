import type { ReactNode } from 'react'
import { Download } from 'lucide-react'

// jan.ai's solid button at its small size: ink fill, Geist Mono caps label
// (mono-button), 35px. Use <Button> in MDX for any call to action (e.g.
// "Open in Jan"); <DownloadButton> is the same with a download icon.
//
// Links to other sites open in a new tab; app links (jan://) and docs pages
// open in place.

export function Button({ href, icon, children }: { href: string; icon?: ReactNode; children: ReactNode }) {
  const external = href.startsWith('http')
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="focus-ring not-prose mt-3 inline-flex h-[35px] items-center gap-2.5 whitespace-nowrap rounded-lg bg-ink px-4 font-mono text-mono-button uppercase text-page no-underline transition-[background-color,transform] duration-150 ease-jan hover:bg-ink/85 motion-safe:active:scale-[0.98] [&_svg]:size-4"
    >
      {icon}
      {children}
    </a>
  )
}

export function DownloadButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button href={href} icon={<Download />}>
      {children}
    </Button>
  )
}
