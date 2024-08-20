import { useMemo } from 'react'

import { Model } from '@janhq/core'

import { useAtomValue } from 'jotai'

import ModelItem from '@/screens/Hub/ModelList/ModelItem'

import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

type Props = {
  models: Model[]
}

const ModelList = ({ models }: Props) => {
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const sortedModels: Model[] = useMemo(() => {
    const recommendedModels: Model[] = []
    const latestModels: Model[] = []
    const featuredModels: Model[] = []
    const remoteModels: Model[] = []
    const localModels: Model[] = []
    const remainingModels: Model[] = []
    models.forEach((m) => {
      if (m.metadata.label) {
        if (m.metadata?.tags?.includes('Featured'))
          recommendedModels.push(m)
        else
          latestModels.push(m)
      } else if (m.metadata?.tags?.includes('Featured')) {
        featuredModels.push(m)
      } else if (m.format === 'api') {
        remoteModels.push(m)
      } else if (downloadedModels.map((m) => m.id).includes(m.id)) {
        localModels.push(m)
      } else {
        remainingModels.push(m)
      }
    })
    latestModels.sort((m1, m2) => m1.metadata?.size - m2.metadata?.size)
    featuredModels.sort((m1, m2) => m1.metadata?.size - m2.metadata?.size)
    remoteModels.sort((m1, m2) => m1.name.localeCompare(m2.name))
    localModels.sort((m1, m2) => m1.metadata?.size - m2.metadata?.size)
    remainingModels.sort((m1, m2) => m1.metadata?.size - m2.metadata?.size)
    return [
      ...recommendedModels,
      ...latestModels,
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
