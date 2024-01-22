import React, { useEffect, useState } from 'react'

import { InferenceEngine, Model } from '@janhq/core'
import { Input } from '@janhq/uikit'

import { useEngineSettings } from '@/hooks/useEngineSettings'

type Props = {
  selectedModel?: Model
  serverEnabled?: boolean
}

const OpenAiKeyInput: React.FC<Props> = ({ selectedModel, serverEnabled }) => {
  const [openAISettings, setOpenAISettings] = useState<
    { api_key: string } | undefined
  >(undefined)
  const { readOpenAISettings, saveOpenAISettings } = useEngineSettings()

  useEffect(() => {
    readOpenAISettings().then((settings) => {
      setOpenAISettings(settings)
    })
  }, [])

  if (!selectedModel || selectedModel.engine !== InferenceEngine.openai) {
    return null
  }

  return (
    <div className="mt-4">
      <label
        id="thread-title"
        className="mb-2 inline-block font-bold text-gray-600 dark:text-gray-300"
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
