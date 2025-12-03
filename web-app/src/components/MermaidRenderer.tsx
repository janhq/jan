import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'

interface MermaidRendererProps {
  chart: string
  className?: string
}

// Initialize mermaid with default configuration
mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
  fontFamily: 'inherit',
})

export const MermaidRenderer = ({ chart, className = '' }: MermaidRendererProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string>('')

  useEffect(() => {
    const renderChart = async () => {
      if (!chart || !containerRef.current) return

      try {
        // Generate a unique ID for this chart
        const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`

        // Render the mermaid chart
        const { svg: renderedSvg } = await mermaid.render(id, chart)
        setSvg(renderedSvg)
        setError('')
      } catch (err) {
        console.error('Mermaid rendering error:', err)
        setError('Failed to render diagram')
      }
    }

    renderChart()
  }, [chart])

  if (error) {
    return (
      <div className={`p-4 border border-destructive/50 rounded-md bg-destructive/5 ${className}`}>
        <p className="text-sm text-destructive">{error}</p>
        <pre className="mt-2 text-xs text-main-view-fg/60 overflow-auto">
          {chart}
        </pre>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={`mermaid-container ${className}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
