import { useCallback } from 'react'

import { Button, Modal } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'
import { Copy } from 'lucide-react'
import { ArrowUpRight } from 'lucide-react'

import BotName from './BotName'
import InputApiKey from './InputApiKey'

import {
  getRemoteModelSetUpStageAtom,
  setRemoteModelSetUpStageAtom,
} from '@/helpers/atoms/SetupRemoteModel.atom'

const SetUpRemoteModelModal: React.FC = () => {
  const setRemoteModelSetUpStage = useSetAtom(setRemoteModelSetUpStageAtom)
  const remoteModelSetUpStage = useAtomValue(getRemoteModelSetUpStageAtom)

  const onSetupClicked = useCallback(() => {
    setRemoteModelSetUpStage('SETUP_API_KEY')
  }, [setRemoteModelSetUpStage])

  return (
    <Modal
      hideClose={true}
      open={remoteModelSetUpStage === 'SETUP_INTRO'}
      onOpenChange={() => setRemoteModelSetUpStage('NONE')}
      content={
        <>
          <div className="flex items-center justify-between">
            <span className="text-xl font-semibold leading-8">
              Open AI gpt 4o
            </span>
            <Button onClick={onSetupClicked} variant="solid">
              <span className="text-sm font-semibold">Setup</span>
            </Button>
          </div>
          <BotName
            className="text-[hsla(var(--text-secondary)] my-4"
            name="Open AI"
            image="https://i.pinimg.com/564x/08/ea/94/08ea94ca94a4b3a04037bdfc335ae00d.jpg"
          />
          <div className="text-[hsla(var(--text-secondary)] mt-4 text-sm leading-[16.94px]">
            GPT-4o (“o” for “omni”) is a step towards much more natural
            human-computer interaction—it accepts as input any combination of
            text, audio, image, and video and generates any combination of text,
            audio, and image outputs. It can respond to audio inputs in as
            little as 232 milliseconds, with an average of 320 milliseconds,
            which is similar tohuman response time(opens in a new window)in a
            conversation. It matches GPT-4 Turbo performance on text in English
            and code, with significant improvement on text in non-English
            languages, while also being much faster and 50% cheaper in the API.
            GPT-4o is especially better at vision and audio understanding
            compared to existing models.
          </div>
          <div className="mt-12 flex items-center gap-2">
            <span>Use it with</span>
            <span>cortex</span>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <InputApiKey
              className="max-w-[355px]"
              placeholder="cortex run openAI-gpt-4o"
            />
            <Button>
              <Copy size={18} />
            </Button>
          </div>
          <span className="mt-4 flex items-center gap-1 text-xs text-blue-400">
            Cortex Quickstart Guide <ArrowUpRight size={12} />
          </span>
        </>
      }
    />
  )
}

export default SetUpRemoteModelModal
