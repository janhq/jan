import React from 'react'

import { InferenceEngine } from '@janhq/core'
import { ScrollArea } from '@janhq/joi'

import { useAtomValue } from 'jotai'

import { useGetEngines } from '@/hooks/useEngineManagement'

import { isLocalEngine } from '@/utils/modelEngine'

import LocalEngineItems from './LocalEngineItem'
import ModalAddRemoteEngine from './ModalAddRemoteEngine'
import RemoteEngineItems from './RemoteEngineItem'

import { showScrollBarAtom } from '@/helpers/atoms/Setting.atom'

const Engines = () => {
  const { engines } = useGetEngines()
  const showScrollBar = useAtomValue(showScrollBarAtom)

  return (
    <ScrollArea
      type={showScrollBar ? 'always' : 'scroll'}
      className="h-full w-full"
    >
      <div className="block w-full px-4">
        <div className="mb-3 mt-4 pb-4">
          <h6 className="text-xs text-[hsla(var(--text-secondary))]">
            Local Engine
          </h6>
          {engines &&
            Object.entries(engines).map(([key]) => {
              if (
                !isLocalEngine(engines, key as InferenceEngine) ||
                !engines[key as InferenceEngine].length
              )
                return
              return (
                <LocalEngineItems engine={key as InferenceEngine} key={key} />
              )
            })}
        </div>
      </div>

      <div className="mt-4 block w-full px-4">
        <div className="mt-4 flex items-center justify-between pb-4">
          <h6 className="text-xs text-[hsla(var(--text-secondary))]">
            Remote Engine
          </h6>
          <ModalAddRemoteEngine />
        </div>
        {engines &&
          Object.entries(engines).map(([key, values]) => {
            if (
              isLocalEngine(engines, key as InferenceEngine) ||
              !values.length
            )
              return
            return (
              <RemoteEngineItems
                engine={key as InferenceEngine}
                key={key}
                values={values}
              />
            )
          })}
      </div>
    </ScrollArea>
  )
}

export default Engines
