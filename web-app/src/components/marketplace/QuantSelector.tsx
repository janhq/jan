import { Button } from '@/components/ui/button'
import { IconDownload } from '@tabler/icons-react'

interface QuantSelectorProps {
  quants: string[]
  selected: string | 'all'
  onSelect: (value: string | 'all') => void
  onDownload: () => void
}

export function QuantSelector({ quants, selected, onSelect, onDownload }: QuantSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <select
        value={selected}
        onChange={(e) => onSelect(e.target.value as string | 'all')}
        className="text-sm px-2 py-1.5 rounded border border-border bg-background"
      >
        <option value="all">全部量化版本</option>
        {quants.map((quant) => (
          <option key={quant} value={quant}>
            {quant}
          </option>
        ))}
      </select>
      <Button size="sm" className="gap-1" onClick={onDownload}>
        <IconDownload size={14} />
        一键下载
      </Button>
    </div>
  )
}
