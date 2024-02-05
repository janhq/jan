import { CommandModal, Modal, ModalContent } from '@janhq/uikit'
import { useAtomValue, useSetAtom } from 'jotai'

import { useConvertHuggingFaceModel } from '@/hooks/useConvertHuggingFaceModel'

import { HuggingFaceConvertingErrorModal } from '../HuggingFaceConvertingErrorModal'
import { HuggingFaceConvertingModal } from '../HuggingFaceConvertingModal'
import { HuggingFaceRepoDataLoadedModal } from '../HuggingFaceRepoDataLoadedModal'
import { HuggingFaceSearchErrorModal } from '../HuggingFaceSearchErrorModal'
import { HuggingFaceSearchModal } from '../HuggingFaceSearchModal'

import {
  repoDataAtom,
  fetchErrorAtom,
  resetAtom,
  conversionStatusAtom,
  conversionErrorAtom,
} from '@/helpers/atoms/HFConverter.atom'

const HuggingFaceModal = ({
  ...props
}: Omit<Parameters<typeof CommandModal>[0], 'children'>) => {
  const repoData = useAtomValue(repoDataAtom)
  const fetchError = useAtomValue(fetchErrorAtom)
  const conversionStatus = useAtomValue(conversionStatusAtom)
  const conversionError = useAtomValue(conversionErrorAtom)
  const setReset = useSetAtom(resetAtom)
  const { cancelConvertHuggingFaceModel } = useConvertHuggingFaceModel()

  return (
    <Modal
      {...props}
      onOpenChange={(open) => {
        if (open === false) {
          setReset()
          if (
            repoData &&
            !['done', 'stopping'].includes(conversionStatus ?? '')
          ) {
            cancelConvertHuggingFaceModel(repoData.id, repoData)
          }
        }
        if (props.onOpenChange) {
          props.onOpenChange(open)
        }
      }}
    >
      <ModalContent>
        <div className="px-2 py-3">
          <div className="flex w-full flex-col items-center justify-center gap-4 p-4">
            {repoData ? (
              conversionStatus ? (
                conversionError ? (
                  <HuggingFaceConvertingErrorModal />
                ) : (
                  <HuggingFaceConvertingModal />
                )
              ) : (
                <HuggingFaceRepoDataLoadedModal />
              )
            ) : fetchError ? (
              <HuggingFaceSearchErrorModal />
            ) : (
              <HuggingFaceSearchModal />
            )}
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}

export { HuggingFaceModal }
