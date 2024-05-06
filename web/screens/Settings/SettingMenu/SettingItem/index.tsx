import { useCallback } from 'react'

import { motion as m } from 'framer-motion'
import { useAtom } from 'jotai'

import { twMerge } from 'tailwind-merge'

import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

type Props = {
  name: string
  setting: string
}

const SettingItem = ({ name, setting }: Props) => {
  const [selectedSetting, setSelectedSetting] = useAtom(selectedSettingAtom)
  const isActive = selectedSetting === setting

  const onSettingItemClick = useCallback(() => {
    setSelectedSetting(setting)
  }, [setting, setSelectedSetting])

  return (
    <div
      className="relative block cursor-pointer px-1 py-1.5"
      onClick={onSettingItemClick}
    >
      <span
        className={twMerge(
          'font-medium capitalize text-[hsla(var(--left-panel-menu))]',
          isActive && 'relative z-10 text-[hsla(var(--left-panel-menu-active))]'
        )}
      >
        {name}
      </span>
      {isActive && (
        <m.div
          className="absolute inset-0 -left-0.5 h-full w-[calc(100%+4px)] rounded-lg bg-[hsla(var(--left-panel-icon-active-bg))]"
          layoutId="active-static-menu"
        />
      )}
    </div>
  )
}

export default SettingItem
