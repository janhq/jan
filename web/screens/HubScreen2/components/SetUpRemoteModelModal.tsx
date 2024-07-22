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

  const author: string = (metadata?.author ?? '') as string
  const logoUrl: string = (metadata?.logo ?? '') as string
  const description: string = (metadata?.description ?? '') as string
  const modelName: string = (metadata?.modelName ?? '') as string
  const modelId: string = (metadata?.modelId ?? '') as string

  return (
    <Modal
      open={stage === 'SETUP_INTRO'}
      onOpenChange={() => setUpRemoteModelStage('NONE', undefined)}
      content={
        <Fragment>
          <HeaderModal
            name={modelName}
            onActionClick={navigateToSetUpApiKey}
            modelId={modelId}
            modelIdVariants={[modelId]}
          />
          <ModelTitle
            className="text-[hsla(var(--text-secondary)] my-4"
            name={author}
            image={logoUrl}
          />

          {description && (
            <span className="font-medium text-[hsla(var(--text-secondary))]">
              {description}
            </span>
          )}
        </Fragment>
      }
    />
  )
}

export default SetUpRemoteModelModal
