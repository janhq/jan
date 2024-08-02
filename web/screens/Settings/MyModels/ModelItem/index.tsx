import { memo, useCallback, useMemo, useState } from 'react'

import { LocalEngines, Model } from '@janhq/core'
import { Badge, Button, useClickOutside } from '@janhq/joi'

import { useAtomValue, useSetAtom } from 'jotai'
import {
  MoreVerticalIcon,
  PlayIcon,
  StopCircleIcon,
  Trash2Icon,
} from 'lucide-react'
import { twMerge } from 'tailwind-merge'

import useModelStart from '@/hooks/useModelStart'
import useModelStop from '@/hooks/useModelStop'
import useModels from '@/hooks/useModels'

import { showWarningMultipleModelModalAtom } from '@/screens/HubScreen2/components/WarningMultipleModelModal'

import { activeModelsAtom } from '@/helpers/atoms/Model.atom'

type Props = {
  model: Model
}

// If more than this number of models are running, show a warning modal.
export const concurrentModelWarningThreshold = 2

const ModelItem: React.FC<Props> = ({ model }) => {
  const activeModels = useAtomValue(activeModelsAtom)
  const startModel = useModelStart()
  const stopModel = useModelStop()
  const [more, setMore] = useState(false)
  const { deleteModel } = useModels()

  const [menu, setMenu] = useState<HTMLDivElement | null>(null)
  const [toggle, setToggle] = useState<HTMLDivElement | null>(null)
  const setShowWarningMultipleModelModal = useSetAtom(
    showWarningMultipleModelModalAtom
  )
  useClickOutside(() => setMore(false), null, [menu, toggle])

  const isActive = useMemo(
    () => activeModels.map((m) => m.model).includes(model.model),
    [activeModels, model.model]
  )

  const onModelActionClick = useCallback(
    (modelId: string) => {
      if (isActive) {
        // if model already active, stop it
        stopModel.mutate(modelId)
        return
      }

      if (activeModels.length >= concurrentModelWarningThreshold) {
        // if max concurrent models reached, stop the first model
        // display popup
        setShowWarningMultipleModelModal(true)
      }
      startModel.mutate(modelId)
    },
    [
      isActive,
      startModel,
      stopModel,
      activeModels.length,
      setShowWarningMultipleModelModal,
    ]
  )

  const onDeleteModelClicked = useCallback(
    async (modelId: string) => {
      await stopModel.mutateAsync(modelId)
      await deleteModel(modelId)
    },
    [stopModel, deleteModel]
  )

  const isLocalModel = LocalEngines.find(
    (e) => model.engine != null && e === model.engine
  )

  return (
    <div className="border border-b-0 border-[hsla(var(--app-border))] bg-[hsla(var(--tertiary-bg))] p-4 first:rounded-t-lg last:rounded-b-lg last:border-b">
      <div className="flex flex-col items-start justify-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-1/2 gap-x-8">
          <div className="flex w-full items-center justify-between">
            <h6
              className={twMerge(
                'line-clamp-1 max-w-[200px] font-medium',
                model.engine !== 'cortex.llamacpp' &&
                  'max-w-none text-[hsla(var(--text-secondary))]'
              )}
              title={model.model}
            >
              {model.model}
            </h6>
            {model.engine === 'cortex.llamacpp' && (
              <div className="flex gap-x-8">
                <p
                  className="line-clamp-1 max-w-[120px] text-[hsla(var(--text-secondary))] xl:max-w-none"
                  title={model.model}
                >
                  {model.model}
                </p>
              </div>
            )}
          </div>
        </div>

        {isLocalModel && (
          <div className="flex gap-x-4">
            <Badge theme="secondary" className="sm:mr-16">
              {model.version != null ? `v${model.version}` : '-'}
            </Badge>

            <div className="relative flex items-center gap-x-4">
              {isActive ? (
                <Badge
                  theme="success"
                  variant="soft"
                  className="inline-flex items-center space-x-2"
                >
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  <span>Active</span>
                </Badge>
              ) : (
                <Badge
                  theme="secondary"
                  className="inline-flex items-center space-x-2"
                >
                  <span className="h-2 w-2 rounded-full bg-gray-500" />
                  <span>Inactive</span>
                </Badge>
              )}
              <div
                className="inline-flex cursor-pointer"
                ref={setToggle}
                onClick={() => {
                  setMore(!more)
                }}
              >
                <Button theme="icon">
                  <MoreVerticalIcon />
                </Button>
                {more && (
                  <div
                    className="shadow-lg absolute right-8 top-0 z-20 w-52 overflow-hidden rounded-lg border border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))]"
                    ref={setMenu}
                  >
                    <div
                      className={twMerge(
                        'flex items-center space-x-2 px-4 py-2 hover:bg-[hsla(var(--dropdown-menu-hover-bg))]'
                      )}
                      onClick={() => {
                        onModelActionClick(model.model)
                        setMore(false)
                      }}
                    >
                      {isActive ? (
                        <StopCircleIcon
                          size={16}
                          className="text-[hsla(var(--text-secondary))]"
                        />
                      ) : (
                        <PlayIcon
                          size={16}
                          className="text-[hsla(var(--text-secondary))]"
                        />
                      )}
                      <span className="text-bold capitalize">
                        {isActive ? 'Stop' : 'Start'}
                        &nbsp;Model
                      </span>
                    </div>
                    <div
                      className={twMerge(
                        'flex cursor-pointer items-center space-x-2 px-4 py-2 hover:bg-[hsla(var(--dropdown-menu-hover-bg))]'
                      )}
                      onClick={() => onDeleteModelClicked(model.model)}
                    >
                      <Trash2Icon
                        size={16}
                        className="text-[hsla(var(--destructive-bg))]"
                      />
                      <span className="text-bold text-[hsla(var(--destructive-bg))]">
                        Delete Model
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(ModelItem)
