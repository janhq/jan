import { useEffect, useState } from 'react'

import { Model } from '@janhq/core'
import {
  Button,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@janhq/uikit'

import { atom, useAtomValue, useSetAtom } from 'jotai'

import { MonitorIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import { MainViewState } from '@/constants/screens'

import { useActiveModel } from '@/hooks/useActiveModel'
import { getDownloadedModels } from '@/hooks/useGetDownloadedModels'

import { useMainViewState } from '@/hooks/useMainViewState'

import { toGigabytes } from '@/utils/converter'

import { activeThreadAtom, threadStatesAtom } from '@/helpers/atoms/Thread.atom'

export const selectedModelAtom = atom<Model | undefined>(undefined)

export default function DropdownListSidebar() {
  const [downloadedModels, setDownloadedModels] = useState<Model[]>([])
  const setSelectedModel = useSetAtom(selectedModelAtom)
  const activeThread = useAtomValue(activeThreadAtom)
  const [selected, setSelected] = useState<Model | undefined>()
  const { setMainViewState } = useMainViewState()

  const { activeModel, stateModel } = useActiveModel()

  useEffect(() => {
    getDownloadedModels().then((downloadedModels) => {
      setDownloadedModels(downloadedModels)
      if (downloadedModels.length > 0) {
        setSelected(
          downloadedModels.filter(
            (x) =>
              x.id === activeThread?.assistants[0].model.id ||
              x.id === activeModel?.id
          )[0] || downloadedModels[0]
        )
        setSelectedModel(
          downloadedModels.filter(
            (x) =>
              x.id === activeThread?.assistants[0].model.id ||
              x.id === activeModel?.id
          )[0] || downloadedModels[0]
        )
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread, activeModel, stateModel.loading])

  const threadStates = useAtomValue(threadStatesAtom)
  if (!activeThread) {
    return null
  }
  const finishInit = threadStates[activeThread.id].isFinishInit ?? true

  const onValueSelected = (value: string) => {
    setSelected(downloadedModels.filter((x) => x.id === value)[0])
    setSelectedModel(downloadedModels.filter((x) => x.id === value)[0])
  }

  return (
    <Select
      disabled={finishInit}
      value={selected?.id}
      onValueChange={finishInit ? undefined : onValueSelected}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Choose model to start">
          {downloadedModels.filter((x) => x.id === selected?.id)[0]?.name}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="right-5 block w-full min-w-[300px] pr-0">
        <div className="flex w-full items-center space-x-2 px-4 py-2">
          <MonitorIcon size={20} className="text-muted-foreground" />
          <span>Local</span>
        </div>
        <div className="border-b border-border" />
        {downloadedModels.length === 0 ? (
          <div className="px-4 py-2">
            <p>Oops, you don't have a model yet.</p>
          </div>
        ) : (
          <SelectGroup>
            {downloadedModels.map((x, i) => (
              <SelectItem
                key={i}
                value={x.id}
                className={twMerge(x.id === selected?.id && 'bg-secondary')}
              >
                <div className="flex w-full justify-between">
                  <span className="line-clamp-1 block">{x.name}</span>
                  <span className="font-bold text-muted-foreground">
                    {toGigabytes(x.metadata.size)}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        <div className="border-b border-border" />
        <div className="w-full px-4 py-2">
          <Button
            block
            className="bg-blue-100 font-bold text-blue-600 hover:bg-blue-100 hover:text-blue-600"
            onClick={() => setMainViewState(MainViewState.Hub)}
          >
            Explore The Hub
          </Button>
        </div>
      </SelectContent>
    </Select>
  )
}
