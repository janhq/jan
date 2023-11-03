import React, { useContext } from 'react'

import { MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/24/outline'

import { useSetAtom, useAtomValue } from 'jotai'

import { FeatureToggleContext } from '@/context/FeatureToggle'

import { MainViewState } from '@/constants/screens'

import useCreateConversation from '@/hooks/useCreateConversation'
import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'

import { useMainViewState } from '@/hooks/useMainViewState'

import SecondaryButton from '../SecondaryButton'

import { showingModalNoActiveModel } from '@/helpers/atoms/Modal.atom'
import { activeAssistantModelAtom } from '@/helpers/atoms/Model.atom'

const LeftHeaderAction: React.FC = () => {
  const { setMainViewState } = useMainViewState()
  const { downloadedModels } = useGetDownloadedModels()
  const activeModel = useAtomValue(activeModelAtom)
  const { requestCreateConvo } = useCreateConversation()
  const setShowModalNoActiveModel = useSetAtom(showingModalNoActiveModel)
  const { experimentalFeatureEnabed } = useContext(FeatureToggleContext)

  const onExploreClick = () => {
    setMainViewState(MainViewState.ExploreModel)
  }

  const onNewConversationClick = () => {
    if (activeModel) {
      requestCreateConvo(activeModel)
    } else {
      setShowModalNoActiveModel(true)
    }
  }

  const onCreateBotClicked = () => {
    if (downloadedModels.length === 0) {
      alert('You need to download at least one model to create a bot.')
      return
    }
    setMainViewState(MainViewState.CreateBot)
  }

  return (
    <div className="sticky top-0 mb-4 bg-background/90 p-4">
      <div className="flex flex-row gap-2">
        <SecondaryButton
          title={'Explore'}
          onClick={onExploreClick}
          className="w-full flex-1"
          icon={<MagnifyingGlassIcon width={16} height={16} />}
        />
        {experimentalFeatureEnabed && (
          <SecondaryButton
            title={'Create bot'}
            onClick={onCreateBotClicked}
            className="w-full flex-1"
            icon={<PlusIcon width={16} height={16} />}
          />
        )}
      </div>
      <button
        onClick={onNewConversationClick}
        className="mt-2 flex w-full items-center space-x-2"
      >
        <PlusIcon width={16} height={16} />
        <span>New Conversation</span>
      </button>
    </div>
  )
}

export default React.memo(LeftHeaderAction)
