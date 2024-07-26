/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'

import { Badge } from '@janhq/joi'
import { useAtomValue } from 'jotai'

import { useSettings } from '@/hooks/useSettings'

import NotEnoughMemoryLabel from './NotEnoughMemoryLabel'

import RecommendedLabel from './RecommendedLabel'

import SlowOnYourDeviceLabel from './SlowOnYourDeviceLabel'

import { activeModelsAtom } from '@/helpers/atoms/Model.atom'
import {
  availableVramAtom,
  totalRamAtom,
  usedRamAtom,
} from '@/helpers/atoms/SystemBar.atom'

type Props = {
  metadata: Record<string, any> | undefined
  compact?: boolean
}

const UnsupportedModel = () => {
  return (
    <Badge className="space-x-1 rounded-md" theme="warning">
      <span>Coming Soon</span>
    </Badge>
  )
}

const ModelLabel = ({ metadata, compact }: Props) => {
  const activeModels = useAtomValue(activeModelsAtom)
  const totalRam = useAtomValue(totalRamAtom)
  const usedRam = useAtomValue(usedRamAtom)
  const availableVram = useAtomValue(availableVramAtom)
  const { settings } = useSettings()

  const getLabel = (size: number) => {
    const activeModelMemoryUsed = activeModels.reduce(
      (acc, model) => acc + Number(model.metadata.size ?? 0),
      0
    )

    const minimumRamModel = size * 1.25
    const availableRam =
      settings?.run_mode === 'gpu'
        ? availableVram * 1000000 // MB to bytes
        : totalRam - usedRam + activeModelMemoryUsed
    if (minimumRamModel > totalRam) {
      return (
        <NotEnoughMemoryLabel
          unit={settings?.run_mode === 'gpu' ? 'VRAM' : 'RAM'}
          compact={compact}
        />
      )
    }
    if (minimumRamModel < availableRam && !compact) {
      return <RecommendedLabel />
    }
    if (minimumRamModel < totalRam && minimumRamModel > availableRam) {
      return <SlowOnYourDeviceLabel compact={compact} />
    }

    return null
  }

  return metadata?.tags?.includes('Coming Soon') ? (
    <UnsupportedModel />
  ) : (
    getLabel(metadata?.size ?? 0)
  )
}

export default React.memo(ModelLabel)
