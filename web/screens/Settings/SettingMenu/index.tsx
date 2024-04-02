import React, { useEffect, useState } from 'react'

import { ScrollArea } from '@janhq/uikit'

import { useAtomValue } from 'jotai'

import SettingItem from './SettingItem'

import { extensionManager } from '@/extension'
import { janSettingScreenAtom } from '@/helpers/atoms/Setting.atom'

const SettingMenu: React.FC = () => {
  const settingScreens = useAtomValue(janSettingScreenAtom)
  const [extensionHasSettings, setExtensionHasSettings] = useState<string[]>([])

  useEffect(() => {
    const getAllSettings = async () => {
      const activeExtensions = await extensionManager.getActive()
      const extensionsMenu: string[] = []

      for (const extension of activeExtensions) {
        const extensionName = extension.name
        if (!extensionName) continue

        const baseExtension = extensionManager.get(extensionName)
        if (!baseExtension) continue

        if (typeof baseExtension.getSettings === 'function') {
          const settings = await baseExtension.getSettings()
          if (settings && settings.length > 0) {
            extensionsMenu.push(extensionName)
          }
        }
      }
      setExtensionHasSettings(extensionsMenu)
    }
    getAllSettings()
  }, [])

  return (
    <div className="flex h-full w-64 flex-shrink-0 flex-col overflow-y-auto border-r border-border">
      <ScrollArea className="h-full w-full">
        <div className="flex-shrink-0 px-6 py-4 font-medium">
          {settingScreens.map((settingScreen) => (
            <SettingItem key={settingScreen} setting={settingScreen} />
          ))}

          {extensionHasSettings.length > 0 && (
            <div className="mb-2 mt-6">
              <label className="text-xs font-medium uppercase text-muted-foreground">
                Extensions
              </label>
            </div>
          )}

          {extensionHasSettings.map((extensionName: string) => (
            <SettingItem
              key={extensionName}
              setting={extensionName}
              extension={true}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

export default React.memo(SettingMenu)
