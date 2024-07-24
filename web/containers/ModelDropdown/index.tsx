import { useState, useCallback, useEffect, useRef } from 'react'

import { LlmEngines, LocalEngines, Model, RemoteEngines } from '@janhq/core'
import { Badge, Input, ScrollArea, Select, useClickOutside } from '@janhq/joi'

import { useAtomValue } from 'jotai'

import { ChevronDownIcon, XIcon } from 'lucide-react'
import { twMerge } from 'tailwind-merge'

import useCortex from '@/hooks/useCortex'

import useSelectModel from '@/hooks/useSelectModel'

import ModelSection from './ModelSection'

import {
  downloadedModelsAtom,
  getSelectedModelAtom,
} from '@/helpers/atoms/Model.atom'
import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

type Props = {
  chatInputMode?: boolean
}

const ModelDropdown: React.FC<Props> = ({ chatInputMode }) => {
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const [searchFilter, setSearchFilter] = useState('all')
  const [filterOptionsOpen, setFilterOptionsOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const { selectModel } = useSelectModel()

  const [open, setOpen] = useState(false)
  const activeThread = useAtomValue(activeThreadAtom)
  const [toggle, setToggle] = useState<HTMLDivElement | null>(null)
  const selectedModel = useAtomValue(getSelectedModelAtom)
  const { createModel } = useCortex()

  const [dropdownOptions, setDropdownOptions] = useState<HTMLDivElement | null>(
    null
  )
  const searchInputRef = useRef<HTMLInputElement>(null)

  useClickOutside(() => !filterOptionsOpen && setOpen(false), null, [
    dropdownOptions,
    toggle,
  ])

  useEffect(() => {
    if (open && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [open])

  const onModelSelected = useCallback(
    async (model: Model) => {
      const isModelAddedToCortex = downloadedModels.find(
        (m) => m.id === model.id || m.model === model.model
      )
      if (!isModelAddedToCortex) {
        await createModel(model)
      }

      selectModel(model)
      setOpen(false)
    },
    [selectModel, createModel, downloadedModels]
  )

  const engines =
    searchFilter === 'local'
      ? LocalEngines
      : searchFilter === 'remote'
        ? RemoteEngines
        : LlmEngines

  if (!activeThread) return null

  const modelId = selectedModel?.id ?? selectedModel?.model ?? ''
  const modelName = selectedModel?.name ?? modelId

  return (
    <div className="relative">
      <div ref={setToggle}>
        {chatInputMode ? (
          <Badge
            theme="secondary"
            className="cursor-pointer"
            onClick={() => setOpen(!open)}
          >
            <span className="line-clamp-1 ">{modelName}</span>
          </Badge>
        ) : (
          <Input
            value={modelName}
            className="cursor-pointer"
            readOnly
            suffixIcon={
              <ChevronDownIcon
                size={14}
                className={twMerge(open && 'rotate-180')}
              />
            }
            onClick={() => setOpen(!open)}
          />
        )}
      </div>
      <div
        className={twMerge(
          'shadow-sm absolute right-0 z-20 mt-2 max-h-[320px] w-full overflow-hidden rounded-lg border border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))]',
          open ? 'flex' : 'hidden',
          chatInputMode && 'bottom-8 left-0 w-72'
        )}
        ref={setDropdownOptions}
      >
        <div className="w-full">
          <div className="relative">
            <Input
              ref={searchInputRef}
              placeholder="Search"
              value={searchText}
              className="rounded-none border-x-0 border-t-0 focus-within:ring-0 hover:border-b-[hsla(var(--app-border))]"
              onChange={(e) => setSearchText(e.target.value)}
              suffixIcon={
                searchText.length > 0 && (
                  <XIcon
                    size={16}
                    className="cursor-pointer"
                    onClick={() => setSearchText('')}
                  />
                )
              }
            />
            <div
              className={twMerge(
                'absolute right-2 top-1/2 -translate-y-1/2',
                searchText.length && 'hidden'
              )}
            >
              <Select
                value={searchFilter}
                className="h-6 gap-1 px-2"
                options={[
                  { name: 'All', value: 'all' },
                  { name: 'On-device', value: 'local' },
                  { name: 'Cloud', value: 'remote' },
                ]}
                onValueChange={(value) => setSearchFilter(value)}
                onOpenChange={(open) => setFilterOptionsOpen(open)}
              />
            </div>
          </div>
          <ScrollArea className="h-[calc(100%-36px)] w-full">
            {engines.map((engine) => (
              <ModelSection
                key={engine}
                searchText={searchText}
                engine={engine}
                onModelSelected={onModelSelected}
              />
            ))}
          </ScrollArea>
        </div>
      </div>
    </div>
  )
}

export default ModelDropdown
