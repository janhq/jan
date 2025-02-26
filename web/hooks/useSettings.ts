import { useCallback, useEffect, useState } from 'react'

import { fs, GpuSettingInfo, joinPath } from '@janhq/core'

export type AppSettings = {
  vulkan: boolean
  gpus: GpuSettingInfo[]
}

export const useSettings = () => {
  const [settings, setSettings] = useState<AppSettings>()

  useEffect(() => {
    readSettings().then((settings) => setSettings(settings as AppSettings))

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const readSettings = useCallback(async () => {
    if (!window?.core?.api) {
      return
    }
    const settingsFile = await joinPath(['file://settings', 'settings.json'])
    if (await fs.existsSync(settingsFile)) {
      const settings = await fs.readFileSync(settingsFile, 'utf-8')
      return typeof settings === 'object' ? settings : JSON.parse(settings)
    }
    return {}
  }, [])

  return {
    readSettings,
    settings,
  }
}
