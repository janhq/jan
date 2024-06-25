import { useCallback } from 'react'

import { Button, Input, Modal } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'
import { Copy } from 'lucide-react'
import { ArrowUpRight } from 'lucide-react'

import BotName from './BotName'

import {
  getRemoteModelBeingSetUpAtom,
  getRemoteModelSetUpStageAtom,
  setRemoteModelSetUpStageAtom,
} from '@/helpers/atoms/SetupRemoteModel.atom'

const SetUpRemoteModelModal: React.FC = () => {
  const setRemoteModelSetUpStage = useSetAtom(setRemoteModelSetUpStageAtom)
  const remoteModelSetUpStage = useAtomValue(getRemoteModelSetUpStageAtom)
  const modelBeingSetUp = useAtomValue(getRemoteModelBeingSetUpAtom)

  const onSetupClicked = useCallback(() => {
    setRemoteModelSetUpStage('SETUP_API_KEY')
  }, [setRemoteModelSetUpStage])

  if (!modelBeingSetUp) return null
  const owner = modelBeingSetUp.metadata?.owned_by ?? ''
  const logoUrl = modelBeingSetUp.metadata?.owner_logo ?? ''
  const description = modelBeingSetUp.metadata?.description ?? ''

  return (
    <Modal
      hideClose={true}
      open={remoteModelSetUpStage === 'SETUP_INTRO'}
      onOpenChange={() => setRemoteModelSetUpStage('NONE')}
      content={
        <>
          <div className="flex items-center justify-between">
            <span className="text-xl font-semibold leading-8">
              {modelBeingSetUp.name}
            </span>
            <Button onClick={onSetupClicked} variant="solid">
              <span className="text-sm font-semibold">Setup</span>
            </Button>
          </div>
          <BotName
            className="text-[hsla(var(--text-secondary)] my-4"
            name={owner}
            image={logoUrl}
          />
          <div className="text-[hsla(var(--text-secondary)] mt-4 text-sm leading-[16.94px]">
            {description}
          </div>
          <div className="mt-12 flex items-center gap-2">
            <span>Use it with</span>
            <span>cortex</span>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Input
              className="max-w-[355px]"
              placeholder="cortex run openAI-gpt-4o"
            />
            <Button>
              <Copy size={18} />
            </Button>
          </div>
          <span className="mt-4 flex items-center justify-start gap-1 text-xs text-blue-600">
            <a
              href={'#'}
              target="_blank"
              rel="noopener noreferrer"
              className="relative flex no-underline"
            >
              Cortex Quickstart Guide <ArrowUpRight size={12} />
            </a>
          </span>
        </>
      }
    />
  )
}

export default SetUpRemoteModelModal
