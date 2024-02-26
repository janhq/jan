import { useState } from 'react'

import { Quantization } from '@janhq/core'
import {
  Button,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectPortal,
  SelectTrigger,
  SelectValue,
} from '@janhq/uikit'
import { useAtomValue } from 'jotai'

import { twMerge } from 'tailwind-merge'

import { useConvertHuggingFaceModel } from '@/hooks/useConvertHuggingFaceModel'

import {
  loadingAtom,
  repoDataAtom,
  unsupportedAtom,
} from '@/helpers/atoms/HFConverter.atom'

export const HuggingFaceRepoDataLoadedModal = () => {
  const loading = useAtomValue(loadingAtom)
  // This component only loads when repoData is not null
  const repoData = useAtomValue(repoDataAtom)!
  const unsupported = useAtomValue(unsupportedAtom)
  const [quantization, setQuantization] = useState<Quantization>(
    Quantization.Q4_K_M
  )
  const { convertHuggingFaceModel } = useConvertHuggingFaceModel()

  const onValueSelected = (value: Quantization) => {
    setQuantization(value)
  }
  const onConvertClick = () => {
    convertHuggingFaceModel(repoData.id, repoData, quantization)
  }

  return (
    <>
      <div className="flex flex-col items-center justify-center gap-1">
        <p className="text-2xl font-bold">Hugging Face Converter</p>
        <p className="text-gray-500">Found the repository!</p>
      </div>
      <div className="flex flex-col items-center justify-center gap-1">
        <p className="font-bold">{repoData.id}</p>
        <p>
          {unsupported
            ? '❌ This model is not supported!'
            : '✅ This model is supported!'}
        </p>
        {repoData.tags.includes('gguf') ? (
          <p>...But you can import it manually!</p>
        ) : null}
      </div>
      <Select
        value={quantization}
        onValueChange={onValueSelected}
        disabled={unsupported}
      >
        <SelectTrigger className="relative w-full">
          <SelectValue placeholder="Quantization">
            <span className={twMerge('relative z-20')}>{quantization}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectPortal>
          <SelectContent className="right-2 block w-full min-w-[450px] pr-0">
            <div className="border-b border-border" />
            <SelectGroup>
              {Object.values(Quantization).map((x, i) => (
                <SelectItem
                  key={i}
                  value={x}
                  className={twMerge(x === quantization && 'bg-secondary')}
                >
                  <div className="flex w-full justify-between">
                    <span className="line-clamp-1 block">{x}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </SelectPortal>
      </Select>
      <Button
        onClick={onConvertClick}
        className="w-full"
        loading={loading}
        disabled={unsupported}
        themes={loading ? 'ghost' : 'primary'}
      >
        {loading ? '' : 'Convert'}
      </Button>
    </>
  )
}
