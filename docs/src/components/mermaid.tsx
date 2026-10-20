'use client'
import { useEffect, useId, useState } from 'react'

// Renders ```mermaid blocks (converted by remarkMermaid in source.config.ts)
// in the browser, so the static export needs no headless browser. Mermaid is
// loaded only on pages that have a diagram.
export function Mermaid({ chart }: { chart: string }) {
  const id = `mermaid-${useId().replace(/:/g, '')}`
  const [svg, setSvg] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { default: mermaid } = await import('mermaid')
        // Same config as the old site (Nextra 2 / @theguild/remark-mermaid).
        mermaid.initialize({
          startOnLoad: false,
          fontFamily: 'inherit',
          themeCSS: 'margin: 1.5rem auto 0;',
          theme: 'default',
        })
        const { svg } = await mermaid.render(id, chart)
        if (!cancelled) setSvg(svg)
      } catch (error) {
        // An invalid chart keeps the source visible below instead of an
        // unhandled rejection; mermaid leaves its error SVG in <body>.
        document.getElementById(`d${id}`)?.remove()
        document.getElementById(id)?.remove()
        if (process.env.NODE_ENV !== 'production') console.error('mermaid:', error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [chart, id])

  if (!svg) {
    return (
      <pre className="not-prose overflow-x-auto rounded-xl border bg-fd-muted p-4 text-sm">
        {chart}
      </pre>
    )
  }
  return (
    <div
      className="not-prose flex justify-center leading-6"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
