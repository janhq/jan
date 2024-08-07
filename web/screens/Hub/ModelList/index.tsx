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
    const featuredModels: Model[] = []
    const remoteModels: Model[] = []
    const localModels: Model[] = []
    const remainingModels: Model[] = []

    models.forEach((m) => {
      if (m.metadata?.tags?.includes('Featured')) {
        featuredModels.push(m)
      } else if (downloadedModels.map((x) => x.model).includes(m.model)) {
        localModels.push(m)
      } else {
        remainingModels.push(m)
      }
    })
    featuredModels.sort((m1, m2) => m1.metadata?.size - m2.metadata?.size)
    remoteModels.sort((m1, m2) => m1.model.localeCompare(m2.model))
    localModels.sort((m1, m2) => m1.metadata?.size - m2.metadata?.size)
    remainingModels.sort((m1, m2) => m1.metadata?.size - m2.metadata?.size)
    return [
      ...featuredModels,
      ...remoteModels,
      ...localModels,
      ...remainingModels,
    ]
  }, [models, downloadedModels])

  return (
    <div className="relative h-full w-full flex-shrink-0">
      {sortedModels?.map((model) => (
        <ModelItem key={model.model} model={model} />
      ))}
    </div>
  )
}

export default ModelList
