import { useState, useEffect } from 'react'

import { InferenceEngine } from '@janhq/core'

import { Button } from '@janhq/joi'
import { useSetAtom } from 'jotai'
import { PlusIcon, SettingsIcon } from 'lucide-react'

import { MainViewState } from '@/constants/screens'

import { extensionManager } from '@/extension'
import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

type Props = {
  engine: InferenceEngine
}

const SetupRemoteModel = ({ engine }: Props) => {
  const setSelectedSetting = useSetAtom(selectedSettingAtom)
  const setMainViewState = useSetAtom(mainViewStateAtom)

  const [extensionHasSettings, setExtensionHasSettings] = useState<
    { name?: string; setting: string; apiKey: string; provider: string }[]
  >([])

  useEffect(() => {
    const getAllSettings = async () => {
      const extensionsMenu: {
        name?: string
        setting: string
        apiKey: string
        provider: string
      }[] = []
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
              apiKey:
                'apiKey' in extension && typeof extension.apiKey === 'string'
                  ? extension.apiKey
                  : '',
              provider:
                'provider' in extension &&
                typeof extension.provider === 'string'
                  ? extension.provider
                  : '',
            })
          }
        }
      }
      setExtensionHasSettings(extensionsMenu)
    }
    getAllSettings()
  }, [])

  const onSetupItemClick = (setting: InferenceEngine) => {
    setMainViewState(MainViewState.Settings)
    setSelectedSetting(
      extensionHasSettings.filter((x) =>
        x.provider.toLowerCase().includes(setting)
      )[0]?.setting
    )
  }

  return (
    <Button
      theme="icon"
      variant="outline"
      onClick={() => {
        onSetupItemClick(engine)
      }}
    >
      <SettingsIcon
        size={14}
        className="text-hsla(var(--app-text-sencondary))"
      />
    </Button>
  )
}

export default SetupRemoteModel
