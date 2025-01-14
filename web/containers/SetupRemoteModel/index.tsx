import { InferenceEngine } from '@janhq/core'

import { Button } from '@janhq/joi'
import { useSetAtom } from 'jotai'
import { SettingsIcon, PlusIcon } from 'lucide-react'

import { MainViewState } from '@/constants/screens'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

type Props = {
  engine: InferenceEngine
  isConfigured: boolean
}

const SetupRemoteModel = ({ engine, isConfigured }: Props) => {
  const setSelectedSetting = useSetAtom(selectedSettingAtom)
  const setMainViewState = useSetAtom(mainViewStateAtom)

  const onSetupItemClick = (setting: InferenceEngine) => {
    setSelectedSetting(setting)
    setMainViewState(MainViewState.Settings)
  }

  return (
    <Button
      theme="icon"
      variant="outline"
      onClick={() => {
        onSetupItemClick(engine)
      }}
    >
      {isConfigured ? (
        <SettingsIcon
          size={14}
          className="text-[hsla(var(--text-secondary))]"
        />
      ) : (
        <PlusIcon size={14} className="text-[hsla(var(--text-secondary))]" />
      )}
    </Button>
  )
}

export default SetupRemoteModel
