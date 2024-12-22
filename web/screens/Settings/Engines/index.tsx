/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useState } from 'react'

import { InferenceEngine } from '@janhq/core'
import { Button, ScrollArea, Input, Switch, Badge } from '@janhq/joi'

import { useAtom, useSetAtom } from 'jotai'
import { SearchIcon, SettingsIcon } from 'lucide-react'

import {
  useGetDefaultEngineVariant,
  useGetEngines,
} from '@/hooks/useEngineManagement'

import { showSettingActiveLocalEngineAtom } from '@/helpers/atoms/Extension.atom'
import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

const EngineItems = ({ engine }: { engine: InferenceEngine }) => {
  const { defaultEngineVariant } = useGetDefaultEngineVariant(engine)

  const manualDescription = (engine: string) => {
    switch (engine) {
      case InferenceEngine.cortex_llamacpp:
        return 'Fast, efficient local inference engine that runs GGUFmodels directly on your device'

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
    <div className="flex w-full flex-col items-start justify-between py-3 sm:flex-row">
      <div className="w-full flex-shrink-0 space-y-1.5">
        <div className="flex items-center justify-between gap-x-2">
          <div>
            <div className="flex items-center gap-2">
              <h6 className="line-clamp-1 font-semibold">{engine}</h6>
              <Badge variant="outline" theme="secondary">
                {defaultEngineVariant?.version}
              </Badge>
            </div>
            <div className="mt-2 w-full font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
              <p>{manualDescription(engine)}</p>
            </div>
          </div>

          <div className="flex items-center gap-x-3">
            <Switch
              checked={!showSettingActiveLocalEngine.includes(engine)}
              onChange={() => onSwitchChange(engine)}
            />
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

const Engines = () => {
  const [searchText, setSearchText] = useState('')
  const { engines } = useGetEngines()

  return (
    <ScrollArea className="h-full w-full">
      <div className="flex w-full flex-col items-start justify-between gap-y-2 p-4 sm:flex-row">
        <div className="w-full sm:w-[300px]">
          <Input
            prefixIcon={<SearchIcon size={16} />}
            placeholder="Search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            clearable={searchText.length > 0}
            onClear={() => setSearchText('')}
          />
        </div>
        {/* <div>
          <input type="file" hidden />
          <Button>Install Engine</Button>
        </div> */}
      </div>

      <div className="block w-full px-4">
        <div className="mb-3 mt-4 border-b border-[hsla(var(--app-border))] pb-4">
          <h6 className="text-xs text-[hsla(var(--text-secondary))]">
            Local Engine
          </h6>
          {engines &&
            Object.entries(engines)
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              .filter(([_, value]) => !(value as { type?: string }).type)
              .map(([key]) => {
                return <EngineItems engine={key as InferenceEngine} key={key} />
              })}
        </div>
      </div>
    </ScrollArea>
  )
}

export default Engines
