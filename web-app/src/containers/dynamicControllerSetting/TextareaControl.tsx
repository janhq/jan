import { Textarea } from '@/components/ui/textarea'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { cn } from '@/lib/utils'

type TextareaControlProps = {
  placeholder?: string
  value: string
  onChange: (value: string) => void
  rows?: number
  inputActions?: string[]
}

export function TextareaControl({
  placeholder = '',
  value = '',
  onChange,
  rows = 4,
}: TextareaControlProps) {
  const { spellCheckChatInput } = useGeneralSetting()

  return (
    <Textarea
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      className={cn('w-full resize-none')}
      spellCheck={spellCheckChatInput}
      data-gramm={spellCheckChatInput}
      data-gramm_editor={spellCheckChatInput}
      data-gramm_grammarly={spellCheckChatInput}
    />
  )
}
