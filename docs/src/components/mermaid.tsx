'use client'
import { useEffect, useId, useState } from 'react'

// Renders ```mermaid blocks (converted by remarkMermaid in source.config.ts)
// in the browser, so the static export needs no headless browser.
export function Mermaid({ chart }: { chart: string }) {
  const id = useId().replace(/:/g, '')
  const [svg, setSvg] = useState('')

  useEffect(() => {
    let cancelled = false
    import('mermaid').then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict' })
      const { svg } = await mermaid.render(`mermaid-${id}`, chart)
      if (!cancelled) setSvg(svg)
    })
    return () => {
      cancelled = true
    }
  }, [chart, id])

  if (!svg) {
    return (
      <pre className="not-prose overflow-x-auto rounded-lg border bg-fd-muted p-4 text-sm">
        {chart}
      </pre>
    )
  }
  return <div className="not-prose my-6 flex justify-center" dangerouslySetInnerHTML={{ __html: svg }} />
}
