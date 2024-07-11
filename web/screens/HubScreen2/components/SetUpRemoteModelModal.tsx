import { Fragment } from 'react'

import { Modal } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'

import HeaderModal from './HeaderModal'
import ModelTitle from './ModelTitle'

import {
  navigateToSetUpApiKeyAtom,
  setUpRemoteModelStageAtom,
} from '@/helpers/atoms/SetupRemoteModel.atom'

const SetUpRemoteModelModal: React.FC = () => {
  const setUpRemoteModelStage = useSetAtom(setUpRemoteModelStageAtom)
  const navigateToSetUpApiKey = useSetAtom(navigateToSetUpApiKeyAtom)
  const { stage, metadata } = useAtomValue(setUpRemoteModelStageAtom)

  const owner: string = (metadata?.owned_by ?? '') as string
  const logoUrl: string = (metadata?.owner_logo ?? '') as string
  const description: string = (metadata?.description ?? '') as string
  const modelName: string = (metadata?.modelName ?? '') as string

  return (
    <Modal
      open={stage === 'SETUP_INTRO'}
      onOpenChange={() => setUpRemoteModelStage('NONE', undefined)}
      content={
        <Fragment>
          <HeaderModal name={modelName} onActionClick={navigateToSetUpApiKey} />
          <ModelTitle
            className="text-[hsla(var(--text-secondary)] my-4"
            name={owner}
            image={logoUrl}
          />

          {description && <span className="font-medium">{description}</span>}
        </Fragment>
      }
    />
  )
}

export default SetUpRemoteModelModal
