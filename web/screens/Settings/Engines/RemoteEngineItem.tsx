import React, { useCallback } from 'react'

import { EngineConfig, InferenceEngine } from '@janhq/core'
import { Button, Switch } from '@janhq/joi'

import { useAtom, useSetAtom } from 'jotai'
import { SettingsIcon } from 'lucide-react'

import { getDescriptionByEngine, getTitleByEngine } from '@/utils/modelEngine'

import { getLogoEngine } from '@/utils/modelEngine'

import ModalDeleteCustomEngine from './ModalDeleteCustomEngine'

import { showSettingActiveRemoteEngineAtom } from '@/helpers/atoms/Extension.atom'
import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

const RemoteEngineItems = ({
  engine,
}: {
  engine: InferenceEngine
  values: EngineConfig[]
}) => {
  const setSelectedSetting = useSetAtom(selectedSettingAtom)
  const customEngineLogo = getLogoEngine(engine)
  const [showSettingActiveRemoteEngine, setShowSettingActiveRemoteEngineAtom] =
    useAtom(showSettingActiveRemoteEngineAtom)

  const onSwitchChange = useCallback(
    (name: string) => {
      if (showSettingActiveRemoteEngine.includes(name)) {
        setShowSettingActiveRemoteEngineAtom(
          [...showSettingActiveRemoteEngine].filter((x) => x !== name)
        )
      } else {
        setShowSettingActiveRemoteEngineAtom([
          ...showSettingActiveRemoteEngine,
          name,
        ])
      }
    },
    [showSettingActiveRemoteEngine, setShowSettingActiveRemoteEngineAtom]
  )
  return (
    <div className="flex w-full flex-col items-start justify-between border-b border-[hsla(var(--app-border))] py-3 sm:flex-row">
      <div className="w-full flex-shrink-0 space-y-1.5">
        <div className="flex items-center justify-between gap-x-2">
          <div>
            <div className="flex items-center gap-2">
              <h6 className="line-clamp-1 font-semibold capitalize">
                {getTitleByEngine(engine as InferenceEngine)}
              </h6>
            </div>
            <div className="mt-2 w-full font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
              <p>{getDescriptionByEngine(engine as InferenceEngine)}</p>
            </div>
          </div>

          <div className="flex items-center gap-x-3">
            <Switch
              checked={!showSettingActiveRemoteEngine.includes(engine)}
              onChange={() => onSwitchChange(engine)}
            />
            {!customEngineLogo && <ModalDeleteCustomEngine engine={engine} />}
            <Button
              theme="icon"
              variant="outline"
              onClick={() => setSelectedSetting(engine)}
            >
              <SettingsIcon
                size={14}
                className="text-[hsla(var(--text-secondary))]"
              />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default RemoteEngineItems
