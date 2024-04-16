import React, { useMemo } from 'react'

import { Badge } from '@janhq/uikit'
import { useAtomValue } from 'jotai'

import { Download } from 'lucide-react'

import { importingHuggingFaceRepoDataAtom } from '@/helpers/atoms/HuggingFace.atom'

const ModelSegmentInfo: React.FC = () => {
  const importingHuggingFaceRepoData = useAtomValue(
    importingHuggingFaceRepoDataAtom
  )

  const { author, modelName, downloads, modelUrl } = useMemo(() => {
    const author =
      (importingHuggingFaceRepoData?.cardData['model_creator'] as string) ??
      'N/A'
    const modelName =
      (importingHuggingFaceRepoData?.cardData['model_name'] as string) ?? 'N/A'
    const modelUrl = importingHuggingFaceRepoData?.modelUrl ?? 'N/A'
    const downloads = importingHuggingFaceRepoData?.downloads ?? 0

    return {
      author,
      modelName,
      modelUrl,
      downloads,
    }
  }, [importingHuggingFaceRepoData])

  if (!importingHuggingFaceRepoData) return null

  return (
    <div className="flex w-full flex-col space-y-4">
      <HeaderInfo title={'Model ID'}>
        <h1 className="text-sm font-medium text-zinc-500 dark:text-gray-300">
          {modelName}
        </h1>
      </HeaderInfo>

      <HeaderInfo title={'Model URL'}>
        <a
          href={modelUrl}
          target="_blank"
          className="line-clamp-1 text-sm font-medium text-blue-600 hover:underline dark:text-blue-300"
        >
          {modelUrl}
        </a>
      </HeaderInfo>

      <div className="flex justify-between space-x-4">
        <div className="flex-1">
          <HeaderInfo title="Author">
            <h1 className="text-sm font-medium text-secondary-foreground">
              {author}
            </h1>
          </HeaderInfo>
        </div>

        <div className="flex-1">
          <HeaderInfo title="Downloads">
            <div className="flex flex-row items-center space-x-1.5">
              <Download
                className="text-zinc-500 dark:text-gray-300"
                size={16}
              />
              <span className="text-sm font-medium text-zinc-500 dark:text-gray-300">
                {downloads}
              </span>
            </div>
          </HeaderInfo>
        </div>
      </div>

      <HeaderInfo title="Tags">
        <div className="mt-2 flex flex-wrap gap-x-1 gap-y-1">
          {importingHuggingFaceRepoData.tags.map((tag) => (
            <Badge
              key={tag}
              themes="primary"
              className="line-clamp-1"
              title={tag}
            >
              {tag}
            </Badge>
          ))}
        </div>
      </HeaderInfo>
    </div>
  )
}

type HeaderInfoProps = {
  title: string
  children: React.ReactNode
}

const HeaderInfo: React.FC<HeaderInfoProps> = ({ title, children }) => {
  return (
    <div className="flex flex-col space-y-2">
      <h1 className="text-sm font-semibold">{title}</h1>
      {children}
    </div>
  )
}

export default React.memo(ModelSegmentInfo)
