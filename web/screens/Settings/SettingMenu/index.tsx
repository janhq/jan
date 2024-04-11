import React, { useEffect, useState } from 'react'

import { ScrollArea } from '@janhq/uikit'

import { useAtomValue } from 'jotai'

import SettingItem from './SettingItem'

import { extensionManager } from '@/extension'
import { janSettingScreenAtom } from '@/helpers/atoms/Setting.atom'

const SettingMenu: React.FC = () => {
  const settingScreens = useAtomValue(janSettingScreenAtom)
  const [extensionHasSettings, setExtensionHasSettings] = useState<
    { name?: string; setting: string }[]
  >([])

  useEffect(() => {
    const getAllSettings = async () => {
      const extensionsMenu: { name?: string; setting: string }[] = []
      const extensions = extensionManager.getAll()
      for (const extension of extensions) {
        if (typeof extension.getSettings === 'function') {
          const settings = await extension.getSettings()
          if (
            (settings && settings.length > 0) ||
            (await extension.installationState()) !== 'NotRequired'
          ) {
            extensionsMenu.push({
              name: extension.productName,
              setting: extension.name,
            })
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
            <SettingItem
              key={settingScreen}
              name={settingScreen}
              setting={settingScreen}
            />
          ))}

          {extensionHasSettings.length > 0 && (
            <div className="mb-2 mt-6">
              <label className="text-xs font-medium uppercase text-muted-foreground">
                Extensions
              </label>
            </div>
          )}

          {extensionHasSettings.map((item) => (
            <SettingItem
              key={item.name}
              name={item.name ?? item.setting}
              setting={item.setting}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

export default React.memo(SettingMenu)
