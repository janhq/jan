import { Download } from 'lucide-react'

// jan.ai's solid button (lg is for heroes; docs use sm): ink fill, Geist Mono
// uppercase label, 35px, a download icon before the label.
export function DownloadButton({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="focus-ring not-prose mt-3 inline-flex h-[35px] items-center gap-2.5 whitespace-nowrap rounded-lg bg-ink px-4 font-mono text-mono-button uppercase text-page no-underline transition-[background-color,transform] duration-150 ease-jan hover:bg-ink/85 motion-safe:active:scale-[0.98]"
    >
      <Download className="size-4" />
      {children}
    </a>
  )
}
