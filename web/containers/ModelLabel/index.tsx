import React from 'react'

import { useAtomValue } from 'jotai'

import { useActiveModel } from '@/hooks/useActiveModel'

import NotEnoughMemoryLabel from './NotEnoughMemoryLabel'

import SlowOnYourDeviceLabel from './SlowOnYourDeviceLabel'

import {
  availableVramAtom,
  totalRamAtom,
  usedRamAtom,
} from '@/helpers/atoms/SystemBar.atom'

type Props = {
  size?: number
  compact?: boolean
}

const ModelLabel = ({ size, compact }: Props) => {
  const { activeModel } = useActiveModel()
  const totalRam = useAtomValue(totalRamAtom)
  const usedRam = useAtomValue(usedRamAtom)
  const availableVram = useAtomValue(availableVramAtom)

  const getLabel = (size: number) => {
    const minimumRamModel = (size * 1.25) / (1024 * 1024)

    const availableRam =
      availableVram > 0
        ? availableVram * 1000000 // MB to bytes
        : totalRam -
          (usedRam +
            (activeModel?.metadata?.size
              ? (activeModel.metadata.size * 1.25) / (1024 * 1024)
              : 0))

    if (minimumRamModel > totalRam) {
      return (
        <NotEnoughMemoryLabel
          unit={availableVram > 0 ? 'VRAM' : 'RAM'}
          compact={compact}
        />
      )
    }

    if (minimumRamModel < totalRam && minimumRamModel > availableRam) {
      return <SlowOnYourDeviceLabel compact={compact} />
    }

    return null
  }

  return getLabel(size ?? 0)
}

export default React.memo(ModelLabel)
