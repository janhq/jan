import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'

import ModelTable from '../ModelTable'
// import SearchBar from '../SearchBar'

const DownloadedModelTable: React.FC = () => {
  const { downloadedModels } = useGetDownloadedModels()

  if (!downloadedModels || downloadedModels.length === 0) return null

  return (
    <div className="mt-5">
      {/* <h3 className="mt-[50px] text-xl leading-[25px]">Downloaded Models</h3> */}
      {/* <div className="w-[568px] py-5">
        <SearchBar />
      </div> */}
      <ModelTable models={downloadedModels} />
    </div>
  )
}

export default DownloadedModelTable
