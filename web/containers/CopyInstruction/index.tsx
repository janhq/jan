import { ChangeEvent, useCallback } from 'react'

import { Switch } from '@janhq/joi'
import { useAtom } from 'jotai'

import { copyOverInstructionEnabledAtom } from '@/helpers/atoms/App.atom'

const CopyOverInstruction: React.FC = () => {
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
    <div className="my-2 flex w-full flex-row items-center justify-center gap-x-2">
      <h6 className="flex-1 font-medium">Save instructions for new threads</h6>
      <Switch
        checked={copyOverInstructionEnabled}
        onChange={onSwitchToggled}
        className="flex-shrink-0"
      />
    </div>
  )
}

export default CopyOverInstruction
