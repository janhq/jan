import React from 'react'

import { ModelMetadata } from '@janhq/core'
import { Badge } from '@janhq/joi'
import { useAtomValue } from 'jotai'

import { useActiveModel } from '@/hooks/useActiveModel'

import { useSettings } from '@/hooks/useSettings'

import NotEnoughMemoryLabel from './NotEnoughMemoryLabel'

import SlowOnYourDeviceLabel from './SlowOnYourDeviceLabel'

import {
  availableVramAtom,
  totalRamAtom,
  usedRamAtom,
} from '@/helpers/atoms/SystemBar.atom'

type Props = {
  metadata: ModelMetadata
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
  const { activeModel } = useActiveModel()
  const totalRam = useAtomValue(totalRamAtom)
  const usedRam = useAtomValue(usedRamAtom)
  const availableVram = useAtomValue(availableVramAtom)
  const { settings } = useSettings()

  const getLabel = (size: number) => {
    const minimumRamModel = size * 1.25
    const availableRam =
      settings?.run_mode === 'gpu'
        ? availableVram * 1000000 // MB to bytes
        : totalRam - usedRam + (activeModel?.metadata?.size ?? 0)
    if (minimumRamModel > totalRam) {
      return (
        <NotEnoughMemoryLabel
          unit={settings?.run_mode === 'gpu' ? 'VRAM' : 'RAM'}
          compact={compact}
        />
      )
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
