/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react'

import { Slider, Input } from '@janhq/uikit'
import { useAtomValue } from 'jotai'
import { twMerge } from 'tailwind-merge'

import useUpdateModelParameters from '@/hooks/useUpdateModelParameters'

import {
  getActiveThreadIdAtom,
  getActiveThreadModelRuntimeParamsAtom,
} from '@/helpers/atoms/Thread.atom'

type Props = {
  name: string
  title: string
  min: number
  max: number
  step: number
  value: number
  register: any
}

const SliderRightPanel: React.FC<Props> = ({
  name,
  title,
  min,
  max,
  step,
  value,
  register,
}) => {
  const [currentValue, setCurrentValue] = useState<number>(value)
  const { updateModelParameter } = useUpdateModelParameters()
  const threadId = useAtomValue(getActiveThreadIdAtom)
  const activeModelParams = useAtomValue(getActiveThreadModelRuntimeParamsAtom)

  useEffect(() => {
    setCurrentValue(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useEffect(() => {
    updateSetting()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentValue])

  const updateValue = [name].reduce((accumulator, value) => {
    return { ...accumulator, [value]: currentValue }
  }, {})

  const updateSetting = () => {
    return updateModelParameter(String(threadId), {
      ...activeModelParams,
      ...updateValue,
    })
  }

  return (
    <div className="flex flex-col">
      <p className="mb-2 text-sm font-semibold text-gray-600">{title}</p>
      <div className="flex items-center gap-x-4">
        <div className="relative w-full">
          <Slider
            {...register(name, {
              setValueAs: (v: any) => parseInt(v),
            })}
            value={[currentValue]}
            onValueChange={async (e) => {
              setCurrentValue(Number(e[0]))
              await updateSetting()
            }}
            type="range"
            min={min}
            max={max}
            step={step}
          />
          <div className="relative mt-2 flex items-center justify-between text-gray-400">
            <p className="text-sm">{min}</p>
            <p className="absolute left-1/2 -translate-x-1/2 text-sm">
              {max / 2}
            </p>
            <p className="text-sm">{max}</p>
          </div>
        </div>
        <Input
          className="-mt-4 h-8 w-16"
          min={min}
          max={max}
          value={String(currentValue)}
          onChange={async (e) => {
            setCurrentValue(Number(e.target.value))
            await updateSetting()
          }}
        />
      </div>
    </div>
  )
}

export default SliderRightPanel
