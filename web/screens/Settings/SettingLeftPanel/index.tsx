import { memo, useEffect, useState } from 'react'

import { useAtomValue } from 'jotai'

import LeftPanelContainer from '@/containers/LeftPanelContainer'

import SettingItem from './SettingItem'

import { extensionManager } from '@/extension'
import { janSettingScreenAtom } from '@/helpers/atoms/Setting.atom'

const SettingLeftPanel = () => {
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
    <LeftPanelContainer>
      <div className="flex-shrink-0 p-3">
        <div className="mb-1 ">
          <label className="text-xs font-medium text-[hsla(var(--text-secondary))]">
            Data folder
          </label>
        </div>

        {settingScreens.map((settingScreen) => (
          <SettingItem
            key={settingScreen}
            name={settingScreen}
            setting={settingScreen}
          />
        ))}

        {extensionHasSettings.length > 0 && (
          <div className="mb-1 mt-4">
            <label className="text-xs font-medium text-[hsla(var(--text-secondary))]">
              Extensions
            </label>
          </div>
        )}

        {extensionHasSettings.map((item) => (
          <SettingItem
            key={item.name}
            name={item.name?.replace('Inference Engine', '') ?? item.setting}
            setting={item.setting}
          />
        ))}
      </div>
    </LeftPanelContainer>
  )
}

export default memo(SettingLeftPanel)
