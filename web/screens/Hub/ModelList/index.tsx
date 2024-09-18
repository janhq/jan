import { useMemo } from 'react'

import { ModelFile } from '@janhq/core'

import { useAtomValue } from 'jotai'

import ModelItem from '@/screens/Hub/ModelList/ModelItem'

import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

type Props = {
  models: ModelFile[]
}

const ModelList = ({ models }: Props) => {
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const sortedModels: ModelFile[] = useMemo(() => {
    const featuredModels: ModelFile[] = []
    const remoteModels: ModelFile[] = []
    const localModels: ModelFile[] = []
    const remainingModels: ModelFile[] = []
    models.forEach((m) => {
      if (m.metadata?.tags?.includes('Featured')) {
        featuredModels.push(m)
      } else if (m.format === 'api') {
        remoteModels.push(m)
      } else if (downloadedModels.map((m) => m.id).includes(m.id)) {
        localModels.push(m)
      } else {
        remainingModels.push(m)
      }
    })
    featuredModels.sort((m1, m2) => m1.metadata.size - m2.metadata.size)
    localModels.sort((m1, m2) => m1.metadata.size - m2.metadata.size)
    remainingModels.sort((m1, m2) => m1.metadata.size - m2.metadata.size)
    remoteModels.sort((m1, m2) => m1.name.localeCompare(m2.name))
    return [
      ...featuredModels,
      ...localModels,
      ...remainingModels,
      ...remoteModels,
    ]
  }, [models, downloadedModels])

  return (
    <div className="relative h-full w-full flex-shrink-0">
      {sortedModels?.map((model) => <ModelItem key={model.id} model={model} />)}
    </div>
  )
}

export default ModelList
