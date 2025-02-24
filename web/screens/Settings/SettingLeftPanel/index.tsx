/* eslint-disable @typescript-eslint/no-unused-vars */
import { memo, useEffect, useState } from 'react'

import { InferenceEngine } from '@janhq/core'
import { useAtomValue } from 'jotai'

import LeftPanelContainer from '@/containers/LeftPanelContainer'

import { useGetEngines } from '@/hooks/useEngineManagement'

import { getTitleByEngine, isLocalEngine } from '@/utils/modelEngine'

import SettingItem from './SettingItem'

import { extensionManager } from '@/extension'

import {
  showSettingActiveLocalEngineAtom,
  showSettingActiveRemoteEngineAtom,
} from '@/helpers/atoms/Extension.atom'
import { janSettingScreenAtom } from '@/helpers/atoms/Setting.atom'

const SettingLeftPanel = () => {
  const { engines } = useGetEngines()
  const settingScreens = useAtomValue(janSettingScreenAtom)

  const showSettingActiveLocalEngine = useAtomValue(
    showSettingActiveLocalEngineAtom
  )
  const showSettingActiveRemoteEngine = useAtomValue(
    showSettingActiveRemoteEngineAtom
  )

  const [extensionHasSettings, setExtensionHasSettings] = useState<
    { name?: string; setting: string }[]
  >([])

  useEffect(() => {
    const getAllSettings = async () => {
      const extensionsMenu: { name?: string; setting: string }[] = []

      const extensions = extensionManager.getAll()

      for (const extension of extensions) {
        const settings = await extension.getSettings()
        if (settings && settings.length > 0 && settings.some((e) => e.title)) {
          extensionsMenu.push({
            name: extension.productName,
            setting: extension.name,
          })
        }
      }

      setExtensionHasSettings(extensionsMenu)
    }
    getAllSettings()
  }, [])

  return (
    <LeftPanelContainer>
      <div className="flex-shrink-0 px-2 py-3">
        <div className="mb-1 px-2">
          <label className="text-xs font-medium text-[hsla(var(--text-secondary))]">
            General
          </label>
        </div>

        {settingScreens.map((settingScreen) => (
          <SettingItem
            key={settingScreen}
            name={settingScreen}
            setting={settingScreen}
          />
        ))}

        {engines &&
          Object.entries(engines).filter(
            ([key]) =>
              isLocalEngine(engines, key as InferenceEngine) &&
              !showSettingActiveLocalEngine.includes(key)
          ).length > 0 && (
            <>
              <div className="mb-1 mt-4 px-2">
                <label className="text-xs font-medium text-[hsla(var(--text-secondary))]">
                  Local Engine
                </label>
              </div>

              {engines &&
                Object.entries(engines)
                  .filter(
                    ([key]) =>
                      !showSettingActiveLocalEngine.includes(key) &&
                      engines[key as InferenceEngine].length > 0
                  )
                  .map(([key]) => {
                    if (!isLocalEngine(engines, key as InferenceEngine)) return
                    return (
                      <SettingItem
                        key={key}
                        name={getTitleByEngine(key as InferenceEngine)}
                        setting={key}
                      />
                    )
                  })}
            </>
          )}

        {engines &&
          Object.entries(engines).filter(
            ([key]) =>
              !isLocalEngine(engines, key as InferenceEngine) &&
              !showSettingActiveRemoteEngine.includes(key)
          ).length > 0 && (
            <>
              <div className="mb-1 mt-4 px-2">
                <label className="text-xs font-medium text-[hsla(var(--text-secondary))]">
                  Remote Engine
                </label>
              </div>

              {engines &&
                Object.entries(engines)
                  .filter(
                    ([key]) =>
                      !showSettingActiveRemoteEngine.includes(key) &&
                      engines[key as InferenceEngine].length > 0
                  )
                  .map(([key]) => {
                    if (isLocalEngine(engines, key as InferenceEngine)) return
                    return (
                      <SettingItem
                        key={key}
                        name={getTitleByEngine(key as InferenceEngine)}
                        setting={key}
                      />
                    )
                  })}
            </>
          )}

        {extensionHasSettings.length > 0 && (
          <div className="mb-1 mt-4 px-2">
            <label className="text-xs font-medium text-[hsla(var(--text-secondary))]">
              Core Extensions
            </label>
          </div>
        )}

        {extensionHasSettings
          .sort((a, b) => String(a.name).localeCompare(String(b.name)))
          .filter((e) => !e.name?.includes('Cortex'))
          .map((item) => (
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
