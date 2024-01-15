import React from 'react'

import { useAtomValue } from 'jotai'

import { useActiveModel } from '@/hooks/useActiveModel'

import NotEnoughRamLabel from './NotEnoughRamLabel'

import RecommendedLabel from './RecommendedLabel'

import SlowOnYourDeviceLabel from './SlowOnYourDeviceLabel'

import { totalRamAtom, usedRamAtom } from '@/helpers/atoms/SystemBar.atom'

type Props = {
  size: number
}

const ModelLabel: React.FC<Props> = ({ size }) => {
  const { activeModel } = useActiveModel()
  const totalRam = useAtomValue(totalRamAtom)
  const usedRam = useAtomValue(usedRamAtom)

  const getLabel = (size: number) => {
    const minimumRamModel = size * 1.25
    const availableRam = totalRam - usedRam + (activeModel?.metadata.size ?? 0)
    if (minimumRamModel > totalRam) {
      return <NotEnoughRamLabel />
    }
    if (minimumRamModel < availableRam) {
      return <RecommendedLabel />
    }
    if (minimumRamModel < totalRam && minimumRamModel > availableRam) {
      return <SlowOnYourDeviceLabel />
    }

    return null
  }

  return getLabel(size)
}

export default React.memo(ModelLabel)
