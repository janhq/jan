import { Fragment, useEffect, useState, useCallback } from 'react'

import { Modal } from '@janhq/joi'
import { useAtom } from 'jotai'

import HeaderModal from './HeaderModal'
import HfListModel from './HfListModel'
import ListModel from './ListModel'

import ModelInformation from './ModelInformation'
import Tab, { ModelTab } from './Tab'

import { localModelModalStageAtom } from '@/helpers/atoms/DownloadLocalModel.atom'

const DownloadLocalModelModal: React.FC = () => {
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [{ stage, modelHandle }, setLocalModelModalStage] = useAtom(
    localModelModalStageAtom
  )
  const [tab, setTab] = useState<ModelTab>('Versions')
  const [height, setHeight] = useState<number>(0)

  useEffect(() => {
    const updateHeight = () => {
      setHeight(window.innerHeight - window.innerHeight * 0.4)
    }
    window.addEventListener('resize', updateHeight)
    updateHeight()
    return () => {
      window.removeEventListener('resize', updateHeight)
    }
  }, [])

  const modelName = modelHandle?.split('/')[1] ?? ''
  const isFromCortexHub = modelHandle?.includes('cortexso') ?? false

  const onModelBranchChanged = useCallback(
    (models: string[]) => {
      const isFromCortexHub = modelHandle?.includes('cortexso') ?? false
      if (isFromCortexHub) {
        setAvailableModels(models)
      } else {
        setAvailableModels(modelHandle != null ? [modelHandle] : [])
      }
    },
    [modelHandle]
  )

  if (!modelHandle) return null

  return (
    <Modal
      className="max-w-[800px]"
      open={stage === 'MODEL_LIST'}
      onOpenChange={() => setLocalModelModalStage('NONE', undefined)}
      content={
        <Fragment>
          <HeaderModal
            modelHandle={modelHandle}
            name={modelName}
            onActionClick={() => {}}
            isLocalModel={true}
            availableModels={availableModels}
          />
          <Tab
            tab={tab}
            handleTab={(input) => setTab(input as 'Versions' | 'Information')}
          />
          {tab === 'Versions' &&
            (isFromCortexHub ? (
              <ListModel
                modelHandle={modelHandle}
                onBranchSelected={onModelBranchChanged}
              />
            ) : (
              <HfListModel modelHandle={modelHandle} />
            ))}
          {tab === 'Information' && (
            <ModelInformation maxHeight={height} modelHandle={modelHandle} />
          )}
        </Fragment>
      }
    />
  )
}

export default DownloadLocalModelModal
