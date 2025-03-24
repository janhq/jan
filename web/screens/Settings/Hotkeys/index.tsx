import { ScrollArea, Badge } from '@janhq/joi'
import { useAtomValue } from 'jotai'

import { showScrollBarAtom } from '@/helpers/atoms/Setting.atom'

const availableHotkeys = [
  {
    combination: 'N',
    modifierKeys: [isMac ? '⌘' : 'Ctrl'],
    description: 'Create a new thread',
  },
  {
    combination: 'B',
    modifierKeys: [isMac ? '⌘' : 'Ctrl'],
    description: 'Toggle left panel',
  },
  {
    combination: 'Shift B',
    modifierKeys: [isMac ? '⌘' : 'Ctrl'],
    description: 'Toggle right panel',
  },
  {
    combination: 'Shift Backspace',
    modifierKeys: [isMac ? '⌘' : 'Ctrl'],
    description: 'Delete current active thread',
  },
  {
    combination: 'Shift C',
    modifierKeys: [isMac ? '⌘' : 'Ctrl'],
    description: 'Clean current active thread',
  },
  {
    combination: ',',
    modifierKeys: [isMac ? '⌘' : 'Ctrl'],
    description: 'Navigate to settings',
  },
  {
    combination: 'Enter',
    description: 'Send a message (in input field)',
  },
  {
    combination: 'Shift Enter',
    description: 'Insert a new line (in input field)',
  },
]

const Hotkeys = () => {
  const showScrollBar = useAtomValue(showScrollBarAtom)
  return (
    <ScrollArea
      type={showScrollBar ? 'always' : 'scroll'}
      className="h-full w-full p-4"
    >
      <div className="mb-2 flex flex-col items-center justify-center gap-2">
        <div className="hidden w-full gap-x-4 border-b border-[hsla(var(--app-border))] pb-2 sm:flex">
          <div className="w-1/2 pb-2">
            <h6 className="font-semibold">Combination</h6>
          </div>
          <div className="w-full pb-2">
            <h6 className="font-semibold">Description</h6>
          </div>
        </div>
        {availableHotkeys.map((shortcut, index) => {
          return (
            <div
              key={shortcut.combination}
              className={
                index === availableHotkeys.length - 1
                  ? 'flex w-full flex-col gap-x-4 pb-2 sm:flex-row'
                  : 'flex w-full flex-col gap-x-4 border-b border-[hsla(var(--app-border))] pb-2 sm:flex-row'
              }
            >
              <div className="flex w-full py-2 sm:w-1/2">
                <div className="bg-secondary inline-flex items-center justify-center rounded-full px-1 py-0.5 text-xs font-bold">
                  <Badge theme="secondary">{`${shortcut.modifierKeys?.[0] ?? ''} ${
                    shortcut.combination
                  }`}</Badge>
                </div>
              </div>
              <div className="w-full py-2">
                <p>{shortcut.description}</p>
              </div>
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

export default Hotkeys
