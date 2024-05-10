import { useCallback, useMemo } from 'react'

import { Modal } from '@janhq/joi'
import { useAtom } from 'jotai'

import ModelDownloadList from './ModelDownloadList'

import ModelSegmentInfo from './ModelSegmentInfo'

import {
  importHuggingFaceModelStageAtom,
  importingHuggingFaceRepoDataAtom,
} from '@/helpers/atoms/HuggingFace.atom'

const HuggingFaceRepoDetailModal = () => {
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
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={importingHuggingFaceRepoData.id}
      content={
        <div className="flex h-full w-full flex-col">
          <div className="flex">
            <ModelSegmentInfo />
            <div className="mx-6 h-full border border-[hsla(var(--app-border))]" />
            <ModelDownloadList />
          </div>
        </div>
      }
    />
  )
}

export default HuggingFaceRepoDetailModal
