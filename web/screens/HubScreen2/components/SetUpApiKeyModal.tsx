import { Fragment, useCallback, useEffect, useState } from 'react'

import Image from 'next/image'

import { Button, Input, Modal } from '@janhq/joi'
import { useAtom } from 'jotai'
import { ArrowUpRight } from 'lucide-react'

import useEngineMutation from '@/hooks/useEngineMutation'
import useEngineQuery from '@/hooks/useEngineQuery'

import { getTitleByCategory } from '@/utils/model-engine'

import { setUpRemoteModelStageAtom } from '@/helpers/atoms/SetupRemoteModel.atom'

const SetUpApiKeyModal: React.FC = () => {
  const updateEngineConfig = useEngineMutation()
  const { data: engineData } = useEngineQuery()

  const [{ stage, remoteEngine, metadata }, setUpRemoteModelStage] = useAtom(
    setUpRemoteModelStageAtom
  )
  const [apiKey, setApiKey] = useState<string>('')

  useEffect(() => {
    if (!remoteEngine || !engineData) return
    const isEngineReady =
      engineData.find((e) => e.name === remoteEngine)?.status === 'ready'
    const fakeApiKey = '******************************************'
    setApiKey(isEngineReady ? fakeApiKey : '')
  }, [remoteEngine, engineData])

  const onSaveClicked = useCallback(async () => {
    if (!remoteEngine) {
      alert('Does not have engine')
      return
    }
    updateEngineConfig.mutate({
      engine: remoteEngine,
      config: {
        config: 'apiKey',
        value: apiKey,
      },
    })
  }, [updateEngineConfig, apiKey, remoteEngine])

  const onDismiss = useCallback(() => {
    setUpRemoteModelStage('NONE', undefined)
  }, [setUpRemoteModelStage])

  if (remoteEngine == null) return null
  const owner: string = getTitleByCategory(remoteEngine)
  const logoUrl: string = (metadata?.logo ?? '') as string
  const apiKeyUrl: string | undefined = (metadata?.api_key_url ?? '') as
    | string
    | undefined

  return (
    <Modal
      onOpenChange={onDismiss}
      open={stage === 'SETUP_API_KEY'}
      content={
        <Fragment>
          <div className="my-4 flex items-center gap-2 text-black">
            {logoUrl && (
              <Image width={24} height={24} src={logoUrl} alt="Model owner" />
            )}
            <h1 className="text-lg font-semibold leading-7 text-[hsla(var(--text-primary))]">
              {owner}
            </h1>
          </div>

          <div className="mb-3 text-sm font-medium leading-4">API Key</div>

          <Input
            placeholder="Input API Key"
            type="text"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />

          {apiKeyUrl && (
            <span className="mt-3 flex items-center justify-start gap-1 text-xs font-medium leading-3 text-blue-600">
              <a
                href={apiKeyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="relative flex no-underline hover:underline"
              >
                Get your API key from {owner} <ArrowUpRight size={12} />
              </a>
            </span>
          )}

          <span className="my-4 flex items-center gap-1 text-xs text-blue-500"></span>
          <div className="flex items-center justify-end gap-3">
            <Button theme="ghost" variant="outline" onClick={onDismiss}>
              Cancel
            </Button>
            <Button disabled={apiKey.length === 0} onClick={onSaveClicked}>
              Save
            </Button>
          </div>
        </Fragment>
      }
    />
  )
}

export default SetUpApiKeyModal
