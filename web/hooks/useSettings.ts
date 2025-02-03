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

  const saveSettings = async ({ vulkan }: { vulkan?: boolean | undefined }) => {
    const settingsFile = await joinPath(['file://settings', 'settings.json'])
    const settings = await readSettings()
    if (vulkan != null) {
      settings.vulkan = vulkan
      // GPU enabled, set run_mode to 'gpu'
      if (settings.vulkan === true) {
        settings?.gpus?.some((gpu: { activated: boolean }) =>
          gpu.activated === true ? 'gpu' : 'cpu'
        )
      }
    }
    await fs.writeFileSync(settingsFile, JSON.stringify(settings))
  }

  return {
    readSettings,
    saveSettings,
    settings,
  }
}
