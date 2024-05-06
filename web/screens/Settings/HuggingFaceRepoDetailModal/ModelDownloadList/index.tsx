import { useMemo } from 'react'

import { ScrollArea } from '@janhq/joi'
import { useAtomValue } from 'jotai'

import ModelDownloadRow from '../ModelDownloadRow'

import { importingHuggingFaceRepoDataAtom } from '@/helpers/atoms/HuggingFace.atom'

const ModelDownloadList = () => {
  const importingHuggingFaceRepoData = useAtomValue(
    importingHuggingFaceRepoDataAtom
  )

  const ggufModels = useMemo(
    () =>
      importingHuggingFaceRepoData?.siblings.filter(
        (e) => e.downloadUrl && e.rfilename.endsWith('.gguf')
      ),
    [importingHuggingFaceRepoData]
  )

  if (!importingHuggingFaceRepoData) return null

  if (!ggufModels || ggufModels.length === 0) {
    return <div>No available GGUF model</div>
  }

  return (
    <div className="flex h-[500px] flex-1 flex-col">
      <h1 className="mb-3 text-sm font-semibold">Available Versions</h1>
      <ScrollArea className="flex-1">
        {ggufModels.map((model, index) => {
          if (!model.downloadUrl) return null
          return (
            <ModelDownloadRow
              repoData={importingHuggingFaceRepoData}
              downloadUrl={model.downloadUrl}
              key={model.rfilename}
              index={index}
              fileName={model.rfilename}
              fileSize={model.fileSize}
              quantization={model.quantization}
            />
          )
        })}
      </ScrollArea>
    </div>
  )
}

export default ModelDownloadList
