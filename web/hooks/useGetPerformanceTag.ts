import { useState } from 'react'

import { ModelPerformance, TagType } from '@/_components/SimpleTag/TagType'
import { useAtomValue } from 'jotai'
import { totalRamAtom } from '@helpers/atoms/SystemBar.atom'

// Recommendation:
// `Recommended (green)`: "Max RAM required" is 80% of users max  RAM.
// `Slow on your device (yellow)`: Max RAM required is 80-100% of users max RAM
// `Not enough RAM (red)`: User RAM is below "Max RAM required"

export default function useGetPerformanceTag() {
  const [performanceTag, setPerformanceTag] = useState<TagType | undefined>()
  const totalRam = useAtomValue(totalRamAtom)

  const getPerformanceForModel = async (modelVersion: ModelVersion) => {
    const requiredRam = modelVersion.maxRamRequired
    setPerformanceTag(calculateRamPerformance(requiredRam, totalRam))
  }

  let title = ''
  switch (performanceTag) {
    case ModelPerformance.PerformancePositive:
      title = 'Recommended'
      break
    case ModelPerformance.PerformanceNeutral:
      title = 'Slow on your device'
      break
    case ModelPerformance.PerformanceNegative:
      title = 'Not enough RAM'
      break
  }

  return { performanceTag, title, getPerformanceForModel }
}

const calculateRamPerformance = (
  requiredRamAmt: number,
  totalRamAmt: number
) => {
  const percentage = requiredRamAmt / totalRamAmt

  if (percentage < 0.8) {
    return ModelPerformance.PerformancePositive
  } else if (percentage >= 0.8 && percentage < 1) {
    return ModelPerformance.PerformanceNeutral
  } else {
    return ModelPerformance.PerformanceNegative
  }
}
