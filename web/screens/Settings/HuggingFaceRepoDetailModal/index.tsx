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
      fullPage
      content={
        <div className="flex h-full max-h-[600px] w-full flex-col overflow-x-hidden lg:max-h-[auto]">
          <div className="flex h-full flex-col justify-between gap-4 lg:flex-row">
            <ModelSegmentInfo />
            <div className="w-full">
              <ModelDownloadList />
            </div>
          </div>
        </div>
      }
    />
  )
}

export default HuggingFaceRepoDetailModal
