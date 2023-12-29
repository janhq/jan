import { useEffect, useState } from 'react'

import { fs, joinPath } from '@janhq/core'

export const useSettings = () => {
  const [isShowNotification, setIsShowNotification] = useState(false)
  const [isGPUModeEnabled, setIsGPUModeEnabled] = useState(false) // New state for GPU mode

  useEffect(() => {
    readSettings().then((settings) => {
      if (
        settings &&
        settings.notify &&
        settings.nvidia_driver?.exist &&
        !settings.cuda?.exist
      ) {
        setIsShowNotification(true)
      }

      // Check if run_mode is 'gpu' or 'cpu' and update state accordingly
      setIsGPUModeEnabled(settings?.run_mode === 'gpu')
    })
  }, [])

  const readSettings = async () => {
    if (!window?.core?.api) {
      return
    }
    const settingsFile = await joinPath(['file://settings', 'settings.json'])
    if (await fs.existsSync(settingsFile)) {
      const settings = await fs.readFileSync(settingsFile, 'utf-8')
      return typeof settings === 'object' ? settings : JSON.parse(settings)
    }
    return {}
  }
  const saveSettings = async ({
    runMode,
    notify,
  }: {
    runMode?: string | undefined
    notify?: boolean | undefined
  }) => {
    const settingsFile = await joinPath(['file://settings', 'settings.json'])
    const settings = await readSettings()
    if (runMode != null) settings.run_mode = runMode
    if (notify != null) settings.notify = notify
    await fs.writeFileSync(settingsFile, JSON.stringify(settings))
  }

  return { isShowNotification, isGPUModeEnabled, readSettings, saveSettings }
}
