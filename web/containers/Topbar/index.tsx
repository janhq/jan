import React from 'react'

import { useUserConfigs } from '@/hooks/useUserConfigs'
import { useAtomValue, useSetAtom } from 'jotai'

import { PanelLeftClose, PanelLeftOpen, PanelRightOpen } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import { getMainViewStateAtom } from '@/helpers/atoms/MainView.atom'
import { MainViewState } from '@/helpers/atoms/MainView.atom'
import { rightSideBarExpandStateAtom } from '@/helpers/atoms/SideBarExpand.atom'

const Topbar = () => {
  const [config, setConfig] = useUserConfigs()
  const viewState = useAtomValue(getMainViewStateAtom)
  const setRightSideBarVisibility = useSetAtom(rightSideBarExpandStateAtom)

  return (
    <div className="fixed left-0 top-0 z-50 flex h-8 w-full justify-between">
      <div
        className={twMerge(
          'unset-drag fixed top-2 block',
          config.sidebarLeftExpand ? 'left-[180px]' : 'left-20'
        )}
      >
        {config.sidebarLeftExpand ? (
          <PanelLeftClose
            size={18}
            onClick={() => setConfig({ ...config, sidebarLeftExpand: false })}
            className="dark:text-gray-400"
          />
        ) : (
          <PanelLeftOpen
            size={18}
            onClick={() => setConfig({ ...config, sidebarLeftExpand: true })}
            className="dark:text-gray-400"
          />
        )}
      </div>
      {viewState === MainViewState.BotInfo && (
        <div className="unset-drag fixed right-4 top-2 block">
          <PanelRightOpen
            size={18}
            onClick={() => setRightSideBarVisibility((prev) => !prev)}
            className="dark:text-gray-400"
          />
        </div>
      )}
    </div>
  )
}

export default Topbar
