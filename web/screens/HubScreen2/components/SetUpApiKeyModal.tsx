import { Fragment, useCallback } from 'react'

import { Button, Modal } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'
import { ArrowUpRight } from 'lucide-react'

import BotName from './BotName'
import InputApiKey from './InputApiKey'

import {
  getRemoteModelSetUpStageAtom,
  setRemoteModelSetUpStageAtom,
} from '@/helpers/atoms/SetupRemoteModel.atom'

const SetUpApiKeyModal: React.FC = () => {
  const setRemoteModelSetUpStage = useSetAtom(setRemoteModelSetUpStageAtom)
  const remoteModelSetUpStage = useAtomValue(getRemoteModelSetUpStageAtom)

  const onSaveClicked = useCallback(() => {}, [])

  return (
    <Modal
      onOpenChange={() => setRemoteModelSetUpStage('NONE')}
      open={remoteModelSetUpStage === 'SETUP_API_KEY'}
      title="Setup Model"
      content={
        <Fragment>
          <BotName
            className="my-4 text-black"
            name="Open AI"
            image="https://i.pinimg.com/564x/08/ea/94/08ea94ca94a4b3a04037bdfc335ae00d.jpg"
          />
          <div className="mb-1 block">API Key</div>
          <InputApiKey placeholder="Insert API Key" />
          <span className="my-4 flex items-center gap-1 text-xs text-blue-400">
            Get your API key from OpenAI <ArrowUpRight size={12} />
          </span>
          <div className="flex items-center justify-end gap-3">
            <Button onClick={() => setRemoteModelSetUpStage('NONE')}>
              Cancel
            </Button>
            <Button onClick={onSaveClicked}>Save</Button>
          </div>
        </Fragment>
      }
    />
  )
}

export default SetUpApiKeyModal
