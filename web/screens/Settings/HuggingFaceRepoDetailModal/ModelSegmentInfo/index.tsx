import { ReactNode, useMemo, memo } from 'react'

import { Badge } from '@janhq/joi'
import { useAtomValue } from 'jotai'

import { Download } from 'lucide-react'

import { importingHuggingFaceRepoDataAtom } from '@/helpers/atoms/HuggingFace.atom'

const ModelSegmentInfo = () => {
  const importingHuggingFaceRepoData = useAtomValue(
    importingHuggingFaceRepoDataAtom
  )

  const { author, modelName, downloads, modelUrl } = useMemo(() => {
    const cardData = importingHuggingFaceRepoData?.cardData
    const author = (cardData?.['model_creator'] ?? 'N/A') as string
    const modelName = (cardData?.['model_name'] ??
      importingHuggingFaceRepoData?.id ??
      'N/A') as string

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
    <div className="flex w-full flex-col space-y-4 lg:w-1/3">
      <HeaderInfo title={'Model ID'}>
        <h1 className="font-medium text-zinc-500 dark:text-gray-300">
          {modelName}
        </h1>
      </HeaderInfo>

      <HeaderInfo title={'Model URL'}>
        <a
          href={modelUrl}
          target="_blank"
          className="line-clamp-1 font-medium text-[hsla(var(--app-link))] hover:underline"
        >
          {modelUrl}
        </a>
      </HeaderInfo>

      <div className="flex justify-between space-x-4">
        <div className="flex-1">
          <HeaderInfo title="Author">
            <h1 className="font-medium text-[hsla(var(--text-secondary))]">
              {author}
            </h1>
          </HeaderInfo>
        </div>

        <div className="flex-1">
          <HeaderInfo title="Downloads">
            <div className="flex flex-row items-center space-x-1.5">
              <Download size={16} />
              <span className="font-medium text-zinc-500 dark:text-gray-300">
                {downloads}
              </span>
            </div>
          </HeaderInfo>
        </div>
      </div>

      <HeaderInfo title="Tags">
        <div className="mt-2 flex h-14 flex-wrap gap-x-1 gap-y-1 overflow-auto lg:h-auto">
          {importingHuggingFaceRepoData.tags.map((tag) => (
            <Badge variant="soft" key={tag} title={tag} className="mt-1">
              <span className="line-clamp-1">{tag}</span>
            </Badge>
          ))}
        </div>
      </HeaderInfo>
    </div>
  )
}

type HeaderInfoProps = {
  title: string
  children: ReactNode
}

const HeaderInfo = ({ title, children }: HeaderInfoProps) => {
  return (
    <div className="flex flex-col space-y-2">
      <h1 className="font-semibold">{title}</h1>
      {children}
    </div>
  )
}

export default memo(ModelSegmentInfo)
