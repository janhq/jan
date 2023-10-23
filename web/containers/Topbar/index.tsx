import React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useUserConfigs } from '@hooks/useUserConfigs'
import {
  leftSideBarExpandStateAtom,
  rightSideBarExpandStateAtom,
} from '@helpers/atoms/SideBarExpand.atom'

import { PanelLeftClose, PanelLeftOpen, PanelRightOpen } from 'lucide-react'
import { twMerge } from 'tailwind-merge'

const Topbar = () => {
  const [config, setConfig] = useUserConfigs()
  const isLeftSidebarVisible = useAtomValue(leftSideBarExpandStateAtom)
  const isRightSidebarVisible = useAtomValue(rightSideBarExpandStateAtom)
  const setLeftSideBarVisibility = useSetAtom(leftSideBarExpandStateAtom)
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
      {/* <div className="unset-drag fixed right-4 top-2 block">
        <PanelRightOpen
          size={18}
          onClick={() => setRightSideBarVisibility((prev) => !prev)}
          className="dark:text-gray-400"
        />
      </div> */}
    </div>
  )
}

export default Topbar
