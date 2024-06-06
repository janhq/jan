import { Fragment, useEffect, useState } from 'react'

import { Modal } from '@janhq/joi'
import { useAtom } from 'jotai'

import useHuggingFace from '@/hooks/useHuggingFace'

import { tryGettingReadMeFile } from '@/utils/huggingface'

import HeaderModal from './HeaderModal'
import HfListModel from './HfListModel'
import ListModel from './ListModel'

import ModelInformation from './ModelInformation'
import Tab, { ModelTab } from './Tab'

import { localModelModalStageAtom } from '@/helpers/atoms/DownloadLocalModel.atom'

const DownloadLocalModelModal: React.FC = () => {
  const [{ stage, modelHandle }, setLocalModelModalStage] = useAtom(
    localModelModalStageAtom
  )
  const [tab, setTab] = useState<ModelTab>('Versions')
  const { getBranches } = useHuggingFace()
  const [height, setHeight] = useState<number>(0)
  const [description, setDescription] = useState<string>('')

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

  useEffect(() => {
    if (!modelHandle) return
    getBranches(modelHandle).catch((e) => {
      console.error('Failed to get HuggingFace revision for', modelHandle, e)
    })
    tryGettingReadMeFile(modelHandle)
      .then((data) => {
        if (data) {
          setDescription(data)
        }
      })
      .catch(console.error)
  }, [modelHandle, getBranches])

  const modelName = modelHandle?.split('/')[1] ?? ''
  if (!modelHandle) return null

  const isFromCortexHub = modelHandle.includes('cortexso')

  return (
    <Modal
      className="max-w-[800px]"
      open={stage === 'MODEL_LIST'}
      onOpenChange={() => setLocalModelModalStage('NONE', undefined)}
      content={
        <Fragment>
          <HeaderModal
            name={modelName}
            onCortexButtonClick={function (): void {
              throw new Error('Function not implemented.')
            }}
            onActionClick={function (): void {
              throw new Error('Function not implemented.')
            }}
          />
          <Tab
            tab={tab}
            handleTab={(input) => setTab(input as 'Versions' | 'Information')}
          />
          {tab === 'Versions' &&
            (isFromCortexHub ? (
              <ListModel modelHandle={modelHandle} />
            ) : (
              <HfListModel modelHandle={modelHandle} />
            ))}
          {tab === 'Information' && (
            <ModelInformation description={description} maxHeight={height} />
          )}
        </Fragment>
      }
    />
  )
}

export default DownloadLocalModelModal
