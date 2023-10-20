import React from 'react'
import SearchBar from '../SearchBar'
import ModelTable from '../ModelTable'
import { useGetDownloadedModels } from '@/_hooks/useGetDownloadedModels'

const DownloadedModelTable: React.FC = () => {
  const { downloadedModels } = useGetDownloadedModels()

  if (!downloadedModels || downloadedModels.length === 0) return null

  return (
    <div className="pl-[63px] pr-[89px]">
      <h3 className="mt-[50px] text-xl leading-[25px]">Downloaded Models</h3>
      <div className="w-[568px] py-5">
        <SearchBar />
      </div>
      <ModelTable models={downloadedModels} />
    </div>
  )
}

export default DownloadedModelTable
