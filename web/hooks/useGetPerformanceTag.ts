import { Model } from '@janhq/core'

import { ModelPerformance, TagType } from '@/constants/tagType'

// Recommendation:
// `Recommended (green)`: "Max RAM required" is 80% of users max  RAM.
// `Slow on your device (yellow)`: Max RAM required is 80-100% of users max RAM
// `Not enough RAM (red)`: User RAM is below "Max RAM required"

export default function useGetPerformanceTag() {
  async function getPerformanceForModel(
    model: Model,
    totalRam: number
  ): Promise<{ title: string; performanceTag: TagType }> {
    const requiredRam = model.metadata.maxRamRequired
    const performanceTag = calculateRamPerformance(requiredRam, totalRam)

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
    return { title, performanceTag }
  }

  return { getPerformanceForModel }
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
