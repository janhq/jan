import { useCallback, useEffect, useState } from 'react'

import { fs, joinPath } from '@janhq/core'

export type AppSettings = {
  run_mode: 'cpu' | 'gpu' | undefined
  notify: boolean
  gpus_in_use: string[]
  vulkan: boolean
  gpus: string[]
}

export const useSettings = () => {
  const [isGPUModeEnabled, setIsGPUModeEnabled] = useState(false) // New state for GPU mode
  const [settings, setSettings] = useState<AppSettings>()

  useEffect(() => {
    readSettings().then((settings) => setSettings(settings as AppSettings))

    setTimeout(() => validateSettings, 3000)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const validateSettings = async () => {
    readSettings().then((settings) => {
      // Check if run_mode is 'gpu' or 'cpu' and update state accordingly
      setIsGPUModeEnabled(settings?.run_mode === 'gpu')
    })
  }

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

  const saveSettings = async ({
    runMode,
    notify,
    gpusInUse,
    vulkan,
  }: {
    runMode?: string | undefined
    notify?: boolean | undefined
    gpusInUse?: string[] | undefined
    vulkan?: boolean | undefined
  }) => {
    const settingsFile = await joinPath(['file://settings', 'settings.json'])
    const settings = await readSettings()
    if (runMode != null) settings.run_mode = runMode
    if (notify != null) settings.notify = notify
    if (gpusInUse != null) settings.gpus_in_use = gpusInUse
    if (vulkan != null) {
      settings.vulkan = vulkan
      // GPU enabled, set run_mode to 'gpu'
      if (settings.vulkan === true) {
        settings.run_mode = 'gpu'
      } else {
        settings.run_mode = 'cpu'
      }
    }
    await fs.writeFileSync(settingsFile, JSON.stringify(settings))
  }

  return {
    isGPUModeEnabled,
    readSettings,
    saveSettings,
    validateSettings,
    settings,
  }
}
