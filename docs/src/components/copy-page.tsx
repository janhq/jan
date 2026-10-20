'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/cn'
import { pageMarkdownUrl } from '@/lib/shared'

// "Copy page": copies the current page as Markdown (the same file as
// /llms.mdx/…) so it can be pasted into an AI chat.
//   button  bordered, under the title where the right sidebar is hidden
//   link    "Copy this page", in the right sidebar's footer links
export function CopyPage({
  variant = 'button',
  className,
}: {
  variant?: 'button' | 'link'
  className?: string
}) {
  const markdownUrl = pageMarkdownUrl(usePathname().split('/').filter(Boolean))
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (state === 'idle') return
    const t = setTimeout(() => setState('idle'), 2000)
    return () => clearTimeout(t)
  }, [state])

  const copy = async () => {
    const markdown = fetch(markdownUrl).then((res) => {
      if (!res.ok) throw new Error(`${res.status}`)
      return res.text()
    })
    try {
      // Hand the clipboard a promise so Safari keeps the click as the user
      // gesture while the file loads.
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': markdown.then((text) => new Blob([text], { type: 'text/plain' })),
          }),
        ])
      } else {
        await navigator.clipboard.writeText(await markdown)
      }
      setState('copied')
    } catch {
      setState('failed')
    }
  }

  const Icon = state === 'copied' ? Check : Copy

  if (variant === 'link') {
    return (
      <button type="button" onClick={copy} aria-live="polite" className={cn('cursor-pointer text-left', className)}>
        <Icon aria-hidden className="size-3.5" strokeWidth={1.75} />
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Couldn’t copy' : 'Copy this page'}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-live="polite"
      className={cn(
        'focus-ring inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-line px-2.5 text-doc-small text-ink/60 transition-colors duration-150 ease-jan hover:bg-surface hover:text-ink dark:bg-surface dark:hover:bg-raised',
        className
      )}
    >
      <Icon className="size-3.5" />
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Couldn’t copy' : 'Copy page'}
    </button>
  )
}
