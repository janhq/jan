import { useCallback, useEffect, useState } from 'react'

import { InferenceEngine, Model } from '@janhq/core'
import {
  Button,
  Select,
  SelectContent,
  SelectGroup,
  SelectPortal,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@janhq/uikit'

import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'

import {
  MonitorIcon,
  LayoutGridIcon,
  FoldersIcon,
  GlobeIcon,
  CheckIcon,
  CopyIcon,
} from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import { MainViewState } from '@/constants/screens'

import { useActiveModel } from '@/hooks/useActiveModel'

import { useClipboard } from '@/hooks/useClipboard'

import useRecommendedModel from '@/hooks/useRecommendedModel'

import useUpdateModelParameters from '@/hooks/useUpdateModelParameters'

import { toGibibytes } from '@/utils/converter'

import ModelLabel from '../ModelLabel'
import OpenAiKeyInput from '../OpenAiKeyInput'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { serverEnabledAtom } from '@/helpers/atoms/LocalServer.atom'

import {
  activeThreadAtom,
  setThreadModelParamsAtom,
} from '@/helpers/atoms/Thread.atom'

export const selectedModelAtom = atom<Model | undefined>(undefined)

const engineOptions = ['Local', 'Remote']

// TODO: Move all of the unscoped logics outside of the component
const DropdownListSidebar = ({
  strictedThread = true,
}: {
  strictedThread?: boolean
}) => {
  const activeThread = useAtomValue(activeThreadAtom)
  const [selectedModel, setSelectedModel] = useAtom(selectedModelAtom)
  const setThreadModelParams = useSetAtom(setThreadModelParamsAtom)
  const [isTabActive, setIsTabActive] = useState(0)
  const { stateModel } = useActiveModel()
  const [serverEnabled, setServerEnabled] = useAtom(serverEnabledAtom)

  const setMainViewState = useSetAtom(mainViewStateAtom)
  const [loader, setLoader] = useState(0)
  const { recommendedModel, downloadedModels } = useRecommendedModel()
  const { updateModelParameter } = useUpdateModelParameters()
  const clipboard = useClipboard({ timeout: 1000 })

  const [copyId, setCopyId] = useState('')

  const localModel = downloadedModels.filter(
    (model) => model.engine === InferenceEngine.nitro
  )
  const remoteModel = downloadedModels.filter(
    (model) => model.engine === InferenceEngine.openai
  )

  const modelOptions = isTabActive === 0 ? localModel : remoteModel

  useEffect(() => {
    if (!activeThread) return

    let model = downloadedModels.find(
      (model) => model.id === activeThread.assistants[0].model.id
    )
    if (!model) {
      model = recommendedModel
    }
    setSelectedModel(model)
  }, [recommendedModel, activeThread, downloadedModels, setSelectedModel])

  // This is fake loader please fix this when we have realtime percentage when load model
  useEffect(() => {
    if (stateModel.model === selectedModel?.id && stateModel.loading) {
      if (loader === 24) {
        setTimeout(() => {
          setLoader(loader + 1)
        }, 250)
      } else if (loader === 50) {
        setTimeout(() => {
          setLoader(loader + 1)
        }, 250)
      } else if (loader === 78) {
        setTimeout(() => {
          setLoader(loader + 1)
        }, 250)
      } else if (loader === 85) {
        setLoader(85)
      } else {
        setLoader(loader + 1)
      }
    } else {
      setLoader(0)
    }
  }, [stateModel.loading, loader, selectedModel, stateModel.model])

  const onValueSelected = useCallback(
    async (modelId: string) => {
      const model = downloadedModels.find((m) => m.id === modelId)
      setSelectedModel(model)

      if (serverEnabled) {
        window.core?.api?.stopServer()
        setServerEnabled(false)
      }

      if (activeThread) {
        const modelParams = {
          ...model?.parameters,
          ...model?.settings,
        }
        // Update model paramter to the thread state
        setThreadModelParams(activeThread.id, modelParams)

        // Update model parameter to the thread file
        if (model)
          updateModelParameter(activeThread.id, {
            params: modelParams,
            modelId: model.id,
            engine: model.engine,
          })
      }
    },
    [
      downloadedModels,
      serverEnabled,
      activeThread,
      setSelectedModel,
      setServerEnabled,
      setThreadModelParams,
      updateModelParameter,
    ]
  )

  if (strictedThread && !activeThread) {
    return null
  }

  const selectedModelLoading =
    stateModel.model === selectedModel?.id && stateModel.loading

  return (
    <>
      <div
        className={twMerge(
          'relative w-full overflow-hidden rounded-md',
          stateModel.loading && 'pointer-events-none',
          selectedModelLoading && 'bg-blue-200 text-blue-600'
        )}
      >
        <Select
          value={selectedModel?.id}
          onValueChange={onValueSelected}
          disabled={serverEnabled}
        >
          <SelectTrigger className="relative w-full">
            <SelectValue placeholder="Choose model to start">
              {selectedModelLoading && (
                <div
                  className="z-5 absolute left-0 top-0 h-full w-full rounded-md bg-blue-100/80"
                  style={{ width: `${loader}%` }}
                />
              )}
              <span
                className={twMerge(
                  'relative z-20',
                  selectedModelLoading && 'font-medium'
                )}
              >
                {selectedModel?.name}
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectPortal>
            <SelectContent
              className={twMerge(
                'right-2  block w-full min-w-[450px] pr-0',
                isTabActive === 1 && '[&_.select-scroll-down-button]:hidden'
              )}
            >
              <div className="relative px-2 py-2">
                <ul className="inline-flex w-full space-x-2 rounded-lg bg-zinc-100 px-1">
                  {engineOptions.map((name, i) => {
                    return (
                      <li
                        className={twMerge(
                          'relative my-1 flex w-full cursor-pointer items-center justify-center space-x-2 px-2 py-2',
                          isTabActive === i && 'rounded-md bg-background'
                        )}
                        key={i}
                        onClick={() => setIsTabActive(i)}
                      >
                        {i === 0 ? (
                          <MonitorIcon
                            size={20}
                            className="z-50 text-muted-foreground"
                          />
                        ) : (
                          <GlobeIcon
                            size={20}
                            className="z-50 text-muted-foreground"
                          />
                        )}
                        <span
                          className={twMerge(
                            'relative z-50 font-medium text-muted-foreground',
                            isTabActive === i && 'font-bold text-foreground'
                          )}
                        >
                          {name}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>

              <div className="border-b border-border" />
              {downloadedModels.length === 0 ? (
                <div className="px-4 py-2">
                  <p>{`Oops, you don't have a model yet.`}</p>
                </div>
              ) : (
                <SelectGroup className="py-2">
                  <>
                    {modelOptions.map((x, i) => (
                      <div
                        key={i}
                        className={twMerge(
                          x.id === selectedModel?.id && 'bg-secondary',
                          'hover:bg-secondary'
                        )}
                      >
                        <SelectItem
                          value={x.id}
                          className={twMerge(
                            x.id === selectedModel?.id && 'bg-secondary',
                            'my-0 pb-8 pt-4'
                          )}
                        >
                          <div className="relative flex w-full justify-between">
                            {x.engine === InferenceEngine.openai && (
                              <svg
                                width="20"
                                height="20"
                                viewBox="0 0 20 20"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                                className="absolute top-1"
                              >
                                <path
                                  d="M18.5681 8.18423C18.7917 7.51079 18.8691 6.79739 18.795 6.09168C18.7209 5.38596 18.497 4.70419 18.1384 4.0919C17.6067 3.16642 16.7948 2.43369 15.8199 1.99936C14.8449 1.56503 13.7572 1.45153 12.7135 1.67523C12.1206 1.0157 11.3646 0.523789 10.5214 0.248906C9.67823 -0.0259764 8.77756 -0.0741542 7.90986 0.109212C7.04216 0.292577 6.23798 0.701031 5.57809 1.29355C4.91821 1.88607 4.42584 2.64179 4.15046 3.48481C3.45518 3.62739 2.79834 3.91672 2.22384 4.33347C1.64933 4.75023 1.1704 5.28481 0.81904 5.90148C0.281569 6.82542 0.0518576 7.89634 0.163116 8.95943C0.274374 10.0225 0.720837 11.0227 1.43796 11.8153C1.21351 12.4884 1.13539 13.2017 1.20883 13.9074C1.28227 14.6132 1.50557 15.2951 1.86379 15.9076C2.39616 16.8334 3.20872 17.5663 4.18438 18.0006C5.16004 18.4349 6.24841 18.5483 7.29262 18.3243C7.76367 18.8548 8.34248 19.2786 8.99038 19.5676C9.63828 19.8566 10.3404 20.004 11.0498 20C12.1195 20.001 13.1618 19.662 14.0263 19.032C14.8909 18.4021 15.5329 17.5137 15.8596 16.4951C16.5548 16.3523 17.2116 16.0629 17.786 15.6461C18.3605 15.2294 18.8395 14.6949 19.191 14.0784C19.7222 13.1558 19.9479 12.0889 19.836 11.0303C19.7242 9.97163 19.2804 8.9754 18.5681 8.18423ZM11.0498 18.691C10.1737 18.6924 9.32512 18.3853 8.65279 17.8236L8.77104 17.7566L12.753 15.4581C12.8521 15.4 12.9343 15.3171 12.9917 15.2176C13.0491 15.118 13.0796 15.0053 13.0802 14.8904V9.27631L14.7635 10.2501C14.7719 10.2544 14.7791 10.2605 14.7846 10.268C14.7901 10.2755 14.7937 10.2843 14.7952 10.2935V14.9456C14.7931 15.9383 14.3978 16.8898 13.6959 17.5917C12.9939 18.2936 12.0425 18.6889 11.0498 18.691ZM2.99921 15.2531C2.55985 14.4945 2.4021 13.6052 2.55371 12.7417L2.67204 12.8127L6.65787 15.1112C6.7565 15.1691 6.86877 15.1996 6.98312 15.1996C7.09747 15.1996 7.20975 15.1691 7.30837 15.1112L12.1774 12.3041V14.2478C12.1769 14.2579 12.1742 14.2677 12.1694 14.2766C12.1646 14.2855 12.1579 14.2932 12.1497 14.2991L8.11654 16.6251C7.25581 17.121 6.2335 17.255 5.27405 16.9978C4.3146 16.7405 3.49644 16.1131 2.99921 15.2531ZM1.95054 6.57965C2.39294 5.81612 3.09123 5.23375 3.92179 4.93565V9.66665C3.92029 9.78094 3.94949 9.89355 4.00635 9.99271C4.06321 10.0919 4.14564 10.174 4.24504 10.2304L9.09037 13.0256L7.40696 13.9994C7.39785 14.0042 7.38769 14.0068 7.37737 14.0068C7.36706 14.0068 7.3569 14.0042 7.34779 13.9994L3.32254 11.6773C2.46343 11.1793 1.83666 10.3612 1.57951 9.40204C1.32236 8.44291 1.45577 7.42095 1.95054 6.55998V6.57965ZM15.7808 9.79281L10.9197 6.96998L12.5992 5.99998C12.6083 5.99514 12.6185 5.99261 12.6288 5.99261C12.6391 5.99261 12.6493 5.99514 12.6584 5.99998L16.6836 8.32606C17.2991 8.68119 17.8008 9.20407 18.1303 9.83365C18.4597 10.4632 18.6032 11.1735 18.5441 11.8816C18.485 12.5898 18.2257 13.2664 17.7964 13.8327C17.3672 14.3989 16.7857 14.8314 16.1199 15.0796V10.3486C16.1164 10.2345 16.0833 10.1232 16.0238 10.0258C15.9644 9.92833 15.8807 9.8481 15.7808 9.79281ZM17.4564 7.27356L17.338 7.20256L13.3601 4.8844C13.2609 4.82617 13.1479 4.79547 13.0329 4.79547C12.9178 4.79547 12.8049 4.82617 12.7056 4.8844L7.84071 7.6914V5.74781C7.83967 5.73793 7.84132 5.72795 7.84549 5.71893C7.84965 5.70991 7.85618 5.70218 7.86437 5.69656L11.8896 3.3744C12.5066 3.01899 13.2119 2.84659 13.9232 2.87736C14.6345 2.90813 15.3224 3.14079 15.9063 3.54813C16.4903 3.95548 16.9461 4.52066 17.2206 5.17759C17.4952 5.83452 17.577 6.55602 17.4565 7.25773L17.4564 7.27356ZM6.92196 10.7191L5.23862 9.74931C5.2302 9.74424 5.223 9.73738 5.21753 9.72921C5.21205 9.72105 5.20845 9.71178 5.20696 9.70206V5.06181C5.20788 4.34996 5.41144 3.65307 5.79383 3.05265C6.17622 2.45222 6.72164 1.97305 7.36632 1.67118C8.011 1.3693 8.7283 1.2572 9.43434 1.34796C10.1404 1.43873 10.806 1.72861 11.3534 2.18373L11.235 2.25081L7.25321 4.54915C7.1541 4.60727 7.07182 4.69017 7.01445 4.78971C6.95707 4.88925 6.92658 5.00201 6.92596 5.1169L6.92196 10.7191ZM7.83662 8.74798L10.005 7.49815L12.1774 8.74798V11.2475L10.0129 12.4972L7.84062 11.2475L7.83662 8.74798Z"
                                  fill="#18181B"
                                />
                              </svg>
                            )}
                            <div
                              className={twMerge(
                                x.engine === InferenceEngine.openai && 'pl-8'
                              )}
                            >
                              <span className="line-clamp-1 block">
                                {x.name}
                              </span>
                              <div className="absolute right-0 top-2 space-x-2">
                                <span className="font-bold text-muted-foreground">
                                  {toGibibytes(x.metadata.size)}
                                </span>
                                {x.engine == InferenceEngine.nitro && (
                                  <ModelLabel size={x.metadata.size} />
                                )}
                              </div>
                            </div>
                          </div>
                        </SelectItem>
                        <div
                          className={twMerge(
                            'absolute -mt-6 inline-flex items-center space-x-2 px-4 pb-2 text-muted-foreground',
                            x.engine === InferenceEngine.openai && 'left-8'
                          )}
                        >
                          <span className="text-xs">{x.id}</span>
                          {clipboard.copied && copyId === x.id ? (
                            <CheckIcon size={16} className="text-green-600" />
                          ) : (
                            <CopyIcon
                              size={16}
                              className="z-20 cursor-pointer"
                              onClick={() => {
                                clipboard.copy(x.id)
                                setCopyId(x.id)
                              }}
                            />
                          )}
                        </div>
                      </div>
                    ))}
                  </>
                </SelectGroup>
              )}
              <div className="border-b border-border" />
              <div className="flex w-full space-x-2 px-4 py-2">
                <Button
                  block
                  themes="secondary"
                  onClick={() => setMainViewState(MainViewState.Settings)}
                >
                  <FoldersIcon size={20} className="mr-2" />
                  <span>My Models</span>
                </Button>
                <Button
                  block
                  className="bg-blue-100 font-bold text-blue-600 hover:bg-blue-100 hover:text-blue-600"
                  onClick={() => setMainViewState(MainViewState.Hub)}
                >
                  <LayoutGridIcon size={20} className="mr-2" />
                  <span>Explore The Hub</span>
                </Button>
              </div>
            </SelectContent>
          </SelectPortal>
        </Select>
      </div>

      <OpenAiKeyInput />
    </>
  )
}

export default DropdownListSidebar
