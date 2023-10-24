import React, { Fragment } from 'react'
import { modelDownloadStateAtom } from '@helpers/atoms/DownloadState.atom'
import { useAtomValue } from 'jotai'
import ModelDownloadingTable from '../ModelDownloadingTable'

const DownloadingModelTable: React.FC = () => {
  const modelDownloadState = useAtomValue(modelDownloadStateAtom)

  const isAnyModelDownloading = Object.values(modelDownloadState).length > 0

  if (!isAnyModelDownloading) return null

  const downloadStates: DownloadState[] = []
  for (const [, value] of Object.entries(modelDownloadState)) {
    downloadStates.push(value)
  }

  return (
    <div className="pl-[63px] pr-[89px]">
      <h3 className="mb-4 mt-[50px] text-xl leading-[25px]">
        Downloading Models
      </h3>
      <ModelDownloadingTable downloadStates={downloadStates} />
    </div>
  )
}

export default DownloadingModelTable
