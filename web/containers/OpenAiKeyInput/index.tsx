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

  const [groqSettings, setGroqSettings] = useState<
  { api_key: string } | undefined
  >(undefined)
  const { readGroqSettings, saveGroqSettings } = useEngineSettings()

  useEffect(() => {
    readOpenAISettings().then((settings) => {
      setOpenAISettings(settings)
    })
  }, [readOpenAISettings])

  useEffect(() => {
    readGroqSettings().then((settings) => {
      setGroqSettings(settings)
    })
  }, [readGroqSettings])

  if (!selectedModel || (selectedModel.engine !== InferenceEngine.openai && selectedModel.engine !== InferenceEngine.groq)) {
    return null;
  }

  const getCurrentApiKey = () => {
    if (selectedModel.engine === InferenceEngine.openai) {
      return openAISettings?.api_key;
    } else if (selectedModel.engine === InferenceEngine.groq) {
      return groqSettings?.api_key;
    }
    return ''; // Default return value
  };

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newApiKey = e.target.value;
    if (selectedModel.engine === InferenceEngine.openai) {
      saveOpenAISettings({ apiKey: newApiKey });
    } else if (selectedModel.engine === InferenceEngine.groq) {
      saveGroqSettings({ apiKey: newApiKey });
    }
  };  

  return (
    <div className="my-4">
      <label
        id="thread-title"
        className="mb-2 inline-block font-bold text-gray-600 dark:text-gray-300"
      >
        API Key
      </label>
      <Input
        disabled={serverEnabled}
        id="assistant-instructions"
        placeholder={getCurrentApiKey()}
        defaultValue={getCurrentApiKey()}
        onChange={handleApiKeyChange}
      />
    </div>
  )
}

export default OpenAiKeyInput
