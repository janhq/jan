import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  IconCopy,
  IconCopyCheck,
  IconEye,
  IconEyeOff,
} from '@tabler/icons-react'
import { useState } from 'react'

type SecretInputProps = Omit<
  React.ComponentProps<typeof Input>,
  'type'
>

export function SecretInput({ className, value, ...props }: SecretInputProps) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

  const stringValue = typeof value === 'string' ? value : String(value ?? '')

  const handleCopy = () => {
    if (!stringValue) return
    navigator.clipboard.writeText(stringValue)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative w-full">
      <Input
        {...props}
        value={value}
        type={revealed ? 'text' : 'password'}
        className={cn('pr-16', className)}
      />
      <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
        <button
          type="button"
          tabIndex={-1}
          aria-label={revealed ? 'Hide' : 'Reveal'}
          className="p-1 rounded text-muted-foreground hover:bg-secondary/50"
          onClick={() => setRevealed((v) => !v)}
        >
          {revealed ? <IconEyeOff size={16} /> : <IconEye size={16} />}
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Copy"
          disabled={!stringValue}
          className="p-1 rounded text-muted-foreground hover:bg-secondary/50 disabled:opacity-40 disabled:pointer-events-none"
          onClick={handleCopy}
        >
          {copied ? (
            <IconCopyCheck size={16} className="text-primary" />
          ) : (
            <IconCopy size={16} />
          )}
        </button>
      </div>
    </div>
  )
}
