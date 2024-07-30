import { useState } from 'react'

import { Button, useMediaQuery } from '@janhq/joi'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { SettingsIcon, ChevronUpIcon, Settings2Icon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import ModelDropdown from '@/containers/ModelDropdown'

import ChatActionButton from './ChatActionButton'
import ChatTextInput from './ChatTextInput'

import { showRightPanelAtom } from '@/helpers/atoms/App.atom'

import { getActiveThreadIdAtom } from '@/helpers/atoms/Thread.atom'
import { activeTabThreadRightPanelAtom } from '@/helpers/atoms/ThreadRightPanel.atom'

const ChatInput: React.FC = () => {
  const setActiveTabThreadRightPanel = useSetAtom(activeTabThreadRightPanelAtom)
  const activeThreadId = useAtomValue(getActiveThreadIdAtom)
  const [activeSetting, setActiveSetting] = useState(false)
  const [showRightPanel, setShowRightPanel] = useAtom(showRightPanelAtom)

  const matches = useMediaQuery('(max-width: 880px)')

  return (
    <div className="relative p-4 pb-2">
      <div className="relative flex w-full flex-col">
        <ChatTextInput isSettingActive={activeSetting} />

        <div className={twMerge('absolute right-3 top-1.5')}>
          <div className="flex items-center gap-x-4">
            {!activeSetting && (
              <div className="flex h-8 items-center">
                <Button
                  theme="icon"
                  onClick={() => setActiveSetting(!activeSetting)}
                >
                  <SettingsIcon
                    size={18}
                    className="text-[hsla(var(--text-secondary))]"
                  />
                </Button>
              </div>
            )}
            <ChatActionButton />
          </div>
        </div>

        {activeSetting && (
          <div
            className={twMerge(
              'absolute bottom-[6px] left-[1px] flex w-[calc(100%-2px)] items-center justify-between rounded-lg bg-[hsla(var(--textarea-bg))] p-3',
              !activeThreadId && 'bg-transparent'
            )}
          >
            <div className="flex items-center gap-x-3">
              <ModelDropdown chatInputMode />
              <Button
                theme="icon"
                onClick={() => {
                  setActiveTabThreadRightPanel('model')
                  if (matches) {
                    setShowRightPanel(!showRightPanel)
                  } else if (!showRightPanel) {
                    setShowRightPanel(true)
                  }
                }}
              >
                <Settings2Icon
                  size={16}
                  className="flex-shrink-0 cursor-pointer text-[hsla(var(--text-secondary))]"
                />
              </Button>
            </div>
            <Button theme="icon" onClick={() => setActiveSetting(false)}>
              <ChevronUpIcon
                size={16}
                className="cursor-pointer text-[hsla(var(--text-secondary))]"
              />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export default ChatInput
