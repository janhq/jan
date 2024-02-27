import React, { useEffect, useState } from 'react'

import { InferenceEngine } from '@janhq/core'
import { Input } from '@janhq/uikit'

import { useAtomValue } from 'jotai'

import { useEngineSettings } from '@/hooks/useEngineSettings'

import { selectedModelAtom } from '../DropdownListSidebar'

import { serverEnabledAtom } from '@/helpers/atoms/LocalServer.atom'

const OpenAiKeyInput: React.FC = () => {
  const selectedModel = useAtomValue(selectedModelAtom)
  const serverEnabled = useAtomValue(serverEnabledAtom)
  const [openAISettings, setOpenAISettings] = useState<
    { api_key: string } | undefined
  >(undefined)
  const { readOpenAISettings, saveOpenAISettings } = useEngineSettings()

  useEffect(() => {
    readOpenAISettings().then((settings) => {
      setOpenAISettings(settings)
    })
  }, [readOpenAISettings])

  if (!selectedModel || selectedModel.engine !== InferenceEngine.openai) {
    return null
  }

  return (
    <div className="my-4">
      <label
        id="thread-title"
        className="mb-2 inline-block font-bold text-gray-600"
      >
        API Key
      </label>
      <Input
        disabled={serverEnabled}
        id="assistant-instructions"
        placeholder="Enter your API_KEY"
        defaultValue={openAISettings?.api_key}
        onChange={(e) => {
          saveOpenAISettings({ apiKey: e.target.value })
        }}
      />
    </div>
  )
}

export default OpenAiKeyInput
