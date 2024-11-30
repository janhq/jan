'use client'

import { useEffect } from 'react'

import { useConfigurations } from '@/hooks/useConfigurations'
import { useLoadTheme } from '@/hooks/useLoadTheme'

const SettingsHandler: React.FC = () => {
  useLoadTheme()

  const { configurePullOptions } = useConfigurations()

  useEffect(() => {
    configurePullOptions()
  }, [configurePullOptions])

  return <></>
}

export default SettingsHandler
