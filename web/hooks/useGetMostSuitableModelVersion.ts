import { useState } from 'react'

import { Model } from '@janhq/core/lib/types'
import { useAtomValue } from 'jotai'

import { totalRamAtom } from '@/helpers/atoms/SystemBar.atom'

export default function useGetMostSuitableModelVersion() {
  const [suitableModel, setSuitableModel] = useState<Model | undefined>()
  const totalRam = useAtomValue(totalRamAtom)

  const getMostSuitableModelVersion = async (modelVersions: Model[]) => {
    // find the model version with the highest required RAM that is still below the user's RAM by 80%
    const modelVersion = modelVersions.reduce((prev, current) => {
      if (current.metadata.maxRamRequired > prev.metadata.maxRamRequired) {
        if (current.metadata.maxRamRequired < totalRam * 0.8) {
          return current
        }
      }
      return prev
    })

    setSuitableModel(modelVersion)
  }

  return { suitableModel, getMostSuitableModelVersion }
}
