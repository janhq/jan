import { ChangeEvent, useCallback } from 'react'

import { Switch } from '@janhq/joi'
import { useAtom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

const COPY_OVER_INSTRUCTION_ENABLED = 'copy_over_instruction_enabled'
export const copyOverInstructionEnabledAtom = atomWithStorage(
  COPY_OVER_INSTRUCTION_ENABLED,
  false
)

const CopyOverInstructionItem: React.FC = () => {
  const [copyOverInstructionEnabled, setCopyOverInstructionEnabled] = useAtom(
    copyOverInstructionEnabledAtom
  )

  const onSwitchToggled = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setCopyOverInstructionEnabled(e.target.checked)
    },
    [setCopyOverInstructionEnabled]
  )

  return (
    <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
      <div className="flex-shrink-0 space-y-1">
        <div className="flex gap-x-2">
          <h6 className="font-semibold capitalize">Copy Over Instruction</h6>
        </div>
        <p className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
          Enable instruction to be copied to new thread
        </p>
      </div>
      {/**/}
      <Switch checked={copyOverInstructionEnabled} onChange={onSwitchToggled} />
    </div>
  )
}

export default CopyOverInstructionItem
