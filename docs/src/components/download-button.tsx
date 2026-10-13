import { Download } from 'lucide-react'

export function DownloadButton({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="not-prose mt-3 inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white no-underline transition-colors hover:bg-gray-800"
    >
      <Download size={16} />
      {children}
    </a>
  )
}
