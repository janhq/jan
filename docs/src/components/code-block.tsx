'use client'
import { useState, type ComponentProps, type MouseEvent } from 'react'
import { Check, Copy } from 'lucide-react'
import { CodeBlock as FumaCodeBlock, Pre } from 'fumadocs-ui/components/codeblock'
import { cn } from '@/lib/cn'

// Code block in jan.ai's look (from janhq/jan.ai src/components/ds/CodeBlock):
// light, bordered, one ink colour (styles in global.css, figure.shiki), with
// jan.ai's copy button in the top-right corner. Built on Fumadocs' CodeBlock so
// titled blocks keep their header row. Replaces every <pre> in MDX.

/** Always visible (touch screens can't hover) at 60%, full on hover, a tick
 *  for 2s after copying. */
function CopyCode() {
  const [copied, setCopied] = useState(false)
  const copy = async (e: MouseEvent<HTMLButtonElement>) => {
    const pre = e.currentTarget.closest('figure')?.querySelector('pre')
    try {
      await navigator.clipboard.writeText(pre?.textContent?.trim() ?? '')
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked: the code can still be selected by hand
    }
  }
  const Icon = copied ? Check : Copy
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? 'Copied' : 'Copy code'}
      className="focus-ring flex size-8 items-center justify-center rounded-lg bg-surface text-ink/60 transition-[color,background-color] duration-150 ease-jan hover:bg-line hover:text-ink"
    >
      <Icon aria-hidden className="size-4" strokeWidth={1.75} />
    </button>
  )
}

export function CodeBlock({ ref: _ref, ...props }: ComponentProps<'pre'>) {
  return (
    <FumaCodeBlock
      {...(props as ComponentProps<typeof FumaCodeBlock>)}
      allowCopy={false}
      Actions={({ className }) => (
        // Untitled blocks: centred on the first line of code (20px padding +
        // half a 20px line), as on jan.ai, on a strip in the block's colour
        // down the right edge (the code's right padding), so long lines that
        // scroll sideways never show beside or under it. Titled blocks: in
        // the header row.
        <div
          className={
            className?.includes('absolute')
              ? 'absolute inset-y-0 right-0 z-2 flex w-14 justify-center bg-surface pt-3'
              : className
          }
        >
          <CopyCode />
        </div>
      )}
    >
      <Pre>{props.children}</Pre>
    </FumaCodeBlock>
  )
}
