import { useCallback, useMemo } from 'react'

import { Modal, ModalContent, ModalHeader, ModalTitle } from '@janhq/uikit'
import { useAtom } from 'jotai'

import ModelDownloadList from './ModelDownloadList'

import ModelSegmentInfo from './ModelSegmentInfo'

import {
  importHuggingFaceModelStageAtom,
  importingHuggingFaceRepoDataAtom,
} from '@/helpers/atoms/HuggingFace.atom'

const HuggingFaceRepoDetailModal: React.FC = () => {
  const [hfImportState, setHfImportState] = useAtom(
    importHuggingFaceModelStageAtom
  )
  const [importingHuggingFaceRepoData, setImportingHuggingFaceRepoData] =
    useAtom(importingHuggingFaceRepoDataAtom)

  const onOpenChange = useCallback(() => {
    setImportingHuggingFaceRepoData(undefined)
    setHfImportState('NONE')
  }, [setHfImportState, setImportingHuggingFaceRepoData])

  const open = useMemo(() => {
    return (
      hfImportState === 'REPO_DETAIL' && importingHuggingFaceRepoData != null
    )
  }, [hfImportState, importingHuggingFaceRepoData])

  if (!importingHuggingFaceRepoData) return null

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[1162px] max-w-[calc(100%-38px)]">
        <ModalHeader>
          <ModalTitle>{importingHuggingFaceRepoData.id}</ModalTitle>
        </ModalHeader>

        <div className="w-full border border-border" />

        <div className="flex h-full w-full flex-col">
          <div className="flex">
            <ModelSegmentInfo />

            <div className="mx-6 h-full border border-border" />

            <ModelDownloadList />
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}

export default HuggingFaceRepoDetailModal
