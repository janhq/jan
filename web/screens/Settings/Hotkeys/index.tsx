import { ScrollArea, Badge } from '@janhq/joi'

const availableHotkeys = [
  {
    combination: 'N',
    modifierKeys: [isMac ? '⌘' : 'Ctrl'],
    description: 'Create a new thread',
  },
  {
    combination: 'E',
    modifierKeys: [isMac ? '⌘' : 'Ctrl'],
    description: 'Show list your models',
  },
  {
    combination: 'K',
    modifierKeys: [isMac ? '⌘' : 'Ctrl'],
    description: 'Show list navigation pages',
  },
  {
    combination: 'B',
    modifierKeys: [isMac ? '⌘' : 'Ctrl'],
    description: 'Toggle collapsible left panel',
  },
  {
    combination: ',',
    modifierKeys: [isMac ? '⌘' : 'Ctrl'],
    description: 'Navigate to setting page',
  },
  {
    combination: 'Enter',
    description: 'Send a message',
  },
  {
    combination: 'Shift + Enter',
    description: 'Insert new line in input box',
  },
  {
    combination: 'Arrow Up',
    description: 'Navigate to previous option (within search dialog)',
  },
  {
    combination: 'Arrow Down',
    description: 'Navigate to next option (within search dialog)',
  },
]

const Hotkeys = () => {
  return (
    <ScrollArea className="h-full w-full p-4">
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
                <div className="inline-flex items-center justify-center rounded-full bg-secondary px-1 py-0.5 text-xs font-bold">
                  <Badge variant="soft">{`${shortcut.modifierKeys?.[0] ?? ''} ${
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
