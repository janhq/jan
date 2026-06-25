import { useCallback, useRef, useState, type HTMLAttributes } from 'react'
import { ClipboardCopy, Download, Check } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

type Format = 'markdown' | 'csv'

function extractRows(table: HTMLTableElement): string[][] {
  return Array.from(table.querySelectorAll('tr')).map((tr) =>
    Array.from(tr.querySelectorAll('th, td')).map((cell) =>
      (cell.textContent ?? '').replace(/\s+/g, ' ').trim()
    )
  )
}

function toCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) =>
          /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
        )
        .join(',')
    )
    .join('\n')
}

function toMarkdown(rows: string[][]): string {
  if (rows.length === 0) return ''
  const [header, ...body] = rows
  const escape = (s: string) => s.replace(/\|/g, '\\|')
  const lines = [`| ${header.map(escape).join(' | ')} |`]
  lines.push(`| ${header.map(() => '---').join(' | ')} |`)
  for (const row of body) {
    lines.push(`| ${row.map(escape).join(' | ')} |`)
  }
  return lines.join('\n')
}

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function MarkdownTable({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLTableElement>) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  const withTable = useCallback(
    (fn: (rows: string[][]) => void) => {
      const table = wrapperRef.current?.querySelector('table')
      if (!table) return
      fn(extractRows(table as HTMLTableElement))
    },
    []
  )

  const copy = useCallback(
    (format: Format) => {
      withTable(async (rows) => {
        const text = format === 'csv' ? toCsv(rows) : toMarkdown(rows)
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1500)
        } catch {
          // ignore — clipboard denied
        }
      })
    },
    [withTable]
  )

  const download = useCallback(
    (format: Format) => {
      withTable((rows) => {
        const text = format === 'csv' ? toCsv(rows) : toMarkdown(rows)
        downloadBlob(
          format === 'csv' ? 'table.csv' : 'table.md',
          text,
          format === 'csv' ? 'text/csv' : 'text/markdown'
        )
      })
    },
    [withTable]
  )

  return (
    <div
      ref={wrapperRef}
      className="my-4 flex flex-col space-y-2"
      data-streamdown="table-wrapper"
    >
      <div className="flex items-center justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="Export table"
              aria-label="Export table"
              className="inline-flex items-center gap-1 rounded-md p-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              {copied ? <Check size={14} /> : <Download size={14} />}
              <span>Export</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[180px]">
            <DropdownMenuItem onSelect={() => copy('markdown')}>
              <ClipboardCopy size={14} />
              Copy as Markdown
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => copy('csv')}>
              <ClipboardCopy size={14} />
              Copy as CSV
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => download('markdown')}>
              <Download size={14} />
              Download .md
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => download('csv')}>
              <Download size={14} />
              Download .csv
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="overflow-x-auto">
        <table
          className={cn('w-full border-collapse border border-border', className)}
          data-streamdown="table"
          {...props}
        >
          {children}
        </table>
      </div>
    </div>
  )
}
