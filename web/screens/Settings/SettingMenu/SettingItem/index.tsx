import { useCallback } from 'react'

import { motion as m } from 'framer-motion'
import { useAtom } from 'jotai'

import { twMerge } from 'tailwind-merge'

import { formatExtensionsName } from '@/utils/converter'

import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

type Props = {
  setting: string
  extension?: boolean
}

const SettingItem: React.FC<Props> = ({ setting, extension = false }) => {
  const [selectedSetting, setSelectedSetting] = useAtom(selectedSettingAtom)
  const isActive = selectedSetting === setting

  const onSettingItemClick = useCallback(() => {
    setSelectedSetting(setting)
  }, [setting, setSelectedSetting])

  return (
    <div
      className="relative block cursor-pointer py-1.5"
      onClick={onSettingItemClick}
    >
      <span className={twMerge(isActive && 'relative z-10', 'capitalize')}>
        {extension ? formatExtensionsName(setting) : setting}
      </span>

      {isActive && (
        <m.div
          className="absolute inset-0 -left-3 h-full w-[calc(100%+24px)] rounded-md bg-primary/50"
          layoutId="active-static-menu"
        />
      )}
    </div>
  )
}

export default SettingItem
