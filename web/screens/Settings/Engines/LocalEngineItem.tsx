import React, { useCallback } from 'react'

import { InferenceEngine } from '@janhq/core'
import { Button, Switch, Badge } from '@janhq/joi'

import { useAtom, useSetAtom } from 'jotai'
import { SettingsIcon } from 'lucide-react'

import { useGetDefaultEngineVariant } from '@/hooks/useEngineManagement'

import { getTitleByEngine } from '@/utils/modelEngine'

import { showSettingActiveLocalEngineAtom } from '@/helpers/atoms/Extension.atom'
import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

const LocalEngineItems = ({ engine }: { engine: InferenceEngine }) => {
  const { defaultEngineVariant } = useGetDefaultEngineVariant(engine)

  const manualDescription = (engine: string) => {
    switch (engine) {
      case InferenceEngine.cortex_llamacpp:
        return 'Fast, efficient local inference engine that runs GGUF models directly on your device.'

      default:
        break
    }
  }

  const setSelectedSetting = useSetAtom(selectedSettingAtom)

  const [showSettingActiveLocalEngine, setShowSettingActiveLocalEngineAtom] =
    useAtom(showSettingActiveLocalEngineAtom)

  const onSwitchChange = useCallback(
    (name: string) => {
      if (showSettingActiveLocalEngine.includes(name)) {
        setShowSettingActiveLocalEngineAtom(
          [...showSettingActiveLocalEngine].filter((x) => x !== name)
        )
      } else {
        setShowSettingActiveLocalEngineAtom([
          ...showSettingActiveLocalEngine,
          name,
        ])
      }
    },
    [showSettingActiveLocalEngine, setShowSettingActiveLocalEngineAtom]
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
              <Badge variant="outline" theme="secondary">
                {defaultEngineVariant?.version}
              </Badge>
            </div>
            <div className="mt-2 w-full font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
              <p>{manualDescription(engine)}</p>
            </div>
          </div>
          <div className="flex items-center gap-x-3">
            {engine !== InferenceEngine.cortex_llamacpp && (
              <Switch
                checked={!showSettingActiveLocalEngine.includes(engine)}
                onChange={() => onSwitchChange(engine)}
              />
            )}
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

export default LocalEngineItems
