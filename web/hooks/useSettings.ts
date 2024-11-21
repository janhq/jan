import { useCallback, useEffect, useState } from 'react'

import { fs, joinPath } from '@janhq/core'

type NvidiaDriver = {
  exist: boolean
  version: string
}

export type AppSettings = {
  run_mode: 'cpu' | 'gpu' | undefined
  notify: boolean
  gpus_in_use: string[]
  vulkan: boolean
  gpus: string[]
  nvidia_driver: NvidiaDriver
  cuda: NvidiaDriver
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
    if (gpusInUse != null) settings.gpus_in_use = gpusInUse.filter((e) => !!e)
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
    readSettings,
    saveSettings,
    settings,
  }
}
