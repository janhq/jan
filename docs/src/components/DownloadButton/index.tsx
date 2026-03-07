import { Download } from 'lucide-react'

type Props = {
  href: string
  children: string
}

export function DownloadButton({ href, children }: Props) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-black text-white text-sm font-medium hover:bg-gray-800 transition-colors no-underline mt-3"
    >
      <Download size={16} />
      {children}
    </a>
  )
}
