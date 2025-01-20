import { Model, ModelSource } from '@janhq/core'

import { useAtomValue } from 'jotai'

import { useGetEngines } from '@/hooks/useEngineManagement'

import ModelItem from '@/screens/Hub/ModelList/ModelItem'

import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'
import { useGetModelSources } from '@/hooks/useModelSource'

type Props = {
  models: Model[]
  onSelectedModel: (model: ModelSource) => void
}

const ModelList = ({ models, onSelectedModel }: Props) => {
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const { engines } = useGetEngines()
  const { sources } = useGetModelSources()
  // const sortedModels: Model[] = useMemo(() => {
  //   const featuredModels: Model[] = []
  //   const remoteModels: Model[] = []
  //   const localModels: Model[] = []
  //   const remainingModels: Model[] = []
  //   models.forEach((m) => {
  //     if (m.metadata?.tags?.includes('Featured')) {
  //       featuredModels.push(m)
  //     } else if (engines?.[m.engine]?.[0]?.type === 'remote') {
  //       remoteModels.push(m)
  //     } else if (downloadedModels.map((m) => m.id).includes(m.id)) {
  //       localModels.push(m)
  //     } else {
  //       remainingModels.push(m)
  //     }
  //   })
  //   featuredModels.sort((m1, m2) => m1.metadata?.size - m2.metadata?.size)
  //   localModels.sort((m1, m2) => m1.metadata?.size - m2.metadata?.size)
  //   remainingModels.sort((m1, m2) => m1.metadata?.size - m2.metadata?.size)
  //   remoteModels.sort((m1, m2) => m1.name.localeCompare(m2.name))
  //   return [
  //     ...featuredModels,
  //     ...localModels,
  //     ...remainingModels,
  //     ...remoteModels,
  //   ]
  // }, [models, downloadedModels, engines])

  return (
    <div className="relative h-full w-full flex-shrink-0">
      {sources?.map((model) => (
        <ModelItem
          key={model.id}
          model={model}
          onSelectedModel={() => onSelectedModel(model)}
        />
      ))}
    </div>
  )
}

export default ModelList
