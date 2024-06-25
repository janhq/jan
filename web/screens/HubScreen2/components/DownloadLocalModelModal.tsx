import { Fragment, useEffect, useState } from 'react'

import { Modal } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'

import { ArrowUpRight } from 'lucide-react'

import useHuggingFace from '@/hooks/useHuggingFace'

import BotName from './BotName'
import ListModel from './ListModel'

import UseWithCortex from './UseWithCortex'

import {
  getDownloadLocalModelStageAtom,
  setDownloadLocalModelStageAtom,
} from '@/helpers/atoms/DownloadLocalModel.atom'
import { getModelHubSelectedModelHandle } from '@/helpers/atoms/ModelHub.atom'

const DownloadLocalModelModal: React.FC = () => {
  const selectedModelHandle = useAtomValue(getModelHubSelectedModelHandle)
  const setDownloadLocalModelStage = useSetAtom(setDownloadLocalModelStageAtom)
  const downloadLocalModelStage = useAtomValue(getDownloadLocalModelStageAtom)

  const { getBranches } = useHuggingFace()
  const [variants, setVariants] = useState<string[]>([])

  useEffect(() => {
    if (!selectedModelHandle) return
    getBranches(selectedModelHandle)
      .then((res) => {
        setVariants(res)
      })
      .catch((e) => {
        console.error(
          'Failed to get HuggingFace revision for',
          selectedModelHandle,
          e
        )
      })
  }, [selectedModelHandle, getBranches])

  const modelName = selectedModelHandle?.split('/')[1] ?? ''
  if (!selectedModelHandle) return null

  return (
    <Modal
      className="max-w-[800px]"
      open={downloadLocalModelStage === 'MODEL_LIST'}
      onOpenChange={() => setDownloadLocalModelStage('NONE')}
      title={modelName}
      content={
        <Fragment>
          <BotName
            className="text-[hsla(var(--text-secondary)] my-4"
            name="Open AI"
            image="https://i.pinimg.com/564x/08/ea/94/08ea94ca94a4b3a04037bdfc335ae00d.jpg"
          />
          <div className="text-[hsla(var(--text-secondary)] mt-4 text-sm leading-[16.94px]">
            Meta Llama 3, a family of models developed by Meta Inc. are new
            state-of-the-art , available in both 8B and 70B parameter sizes
            (pre-trained or instruction-tuned). Llama 3 instruction-tuned models
            are fine-tuned and optimized for dialogue/chat use cases and
            outperform many of the available open-source chat models on common
            benchmarks.
          </div>
          <ListModel modelHandle={selectedModelHandle} />
          <div className="mt-12 flex items-center gap-2">
            <span>Use it with</span>
            <span>cortex</span>
          </div>
          <UseWithCortex variants={variants} />
          <span className="mt-4 flex items-center gap-1 text-xs text-blue-400">
            Cortex Quickstart Guide <ArrowUpRight size={12} />
          </span>
        </Fragment>
      }
    />
  )
}

export default DownloadLocalModelModal
