import { Fragment, useCallback, useState } from 'react'

import { Button, Modal } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'
import { ArrowUpRight } from 'lucide-react'

import useCortex from '@/hooks/useCortex'

import BotName from './BotName'

import {
  clearRemoteModelBeingSetUpAtom,
  getRemoteModelBeingSetUpAtom,
  getRemoteModelSetUpStageAtom,
  setRemoteModelSetUpStageAtom,
} from '@/helpers/atoms/SetupRemoteModel.atom'
import { toaster } from '@/containers/Toast'

const SetUpApiKeyModal: React.FC = () => {
  const { createModel, registerEngineConfig } = useCortex()
  const setRemoteModelSetUpStage = useSetAtom(setRemoteModelSetUpStageAtom)
  const clearModelBeingSetUp = useSetAtom(clearRemoteModelBeingSetUpAtom)
  const remoteModelSetUpStage = useAtomValue(getRemoteModelSetUpStageAtom)
  const model = useAtomValue(getRemoteModelBeingSetUpAtom)

  const [apiKey, setApiKey] = useState<string>('')

  const onSaveClicked = useCallback(async () => {
    const engine = model?.engine
    if (!engine) {
      alert('Does not have engine')
      return
    }
    try {
      await registerEngineConfig(engine, {
        key: 'apiKey',
        value: apiKey,
        name: engine,
      })
      await createModel(model)
      setRemoteModelSetUpStage('NONE')
      toaster({
        title: 'Success!',
        description: `Key added successfully`,
        type: 'success',
      })
    } catch (error) {
      alert(error)
    }
  }, [
    createModel,
    registerEngineConfig,
    setRemoteModelSetUpStage,
    model,
    apiKey,
  ])

  const onDismiss = useCallback(() => {
    clearModelBeingSetUp()
    setRemoteModelSetUpStage('NONE')
  }, [setRemoteModelSetUpStage, clearModelBeingSetUp])

  if (model == null) return null
  const owner: string = model.metadata?.owned_by ?? ''
  const logoUrl: string = model.metadata?.owner_logo ?? ''
  const apiKeyUrl = model.metadata?.api_key_url ?? ''

  return (
    <Modal
      onOpenChange={onDismiss}
      open={remoteModelSetUpStage === 'SETUP_API_KEY'}
      title="Setup Model"
      content={
        <Fragment>
          <BotName className="my-4 text-black" name={owner} image={logoUrl} />
          <div className="mb-1 block">API Key</div>
          <input
            className="text-[hsla(var(--text-secondary)] w-full rounded-md border p-2 leading-[16.94px]"
            placeholder="Input API Key"
            type="text"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <span className="mt-4 flex items-center justify-start gap-1 text-xs text-blue-600">
            <a
              href={apiKeyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="relative flex no-underline"
            >
              Get your API key from {owner} <ArrowUpRight size={12} />
            </a>
          </span>
          <span className="my-4 flex items-center gap-1 text-xs text-blue-500"></span>
          <div className="flex items-center justify-end gap-3">
            <Button onClick={onDismiss}>Cancel</Button>
            <Button onClick={onSaveClicked}>Save</Button>
          </div>
        </Fragment>
      }
    />
  )
}

export default SetUpApiKeyModal
