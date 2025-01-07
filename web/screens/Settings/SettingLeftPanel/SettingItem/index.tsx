import { useCallback } from 'react'

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
      className={twMerge(
        'relative my-0.5 block cursor-pointer rounded-lg px-2 py-1.5 hover:bg-[hsla(var(--left-panel-menu-hover))]',
        isActive && 'rounded-lg bg-[hsla(var(--left-panel-icon-active-bg))]'
      )}
      onClick={onSettingItemClick}
    >
      <span
        className={twMerge(
          'p-1.5 font-medium  text-[hsla(var(--left-panel-menu))]',
          isActive && 'relative z-10 text-[hsla(var(--left-panel-menu-active))]'
        )}
      >
        {name}
      </span>
    </div>
  )
}

export default SettingItem
