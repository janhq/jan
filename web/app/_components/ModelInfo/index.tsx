import Image from 'next/image'
import ModelInfoItem from '../ModelInfoItem'
import React from 'react'

type Props = {
  modelName: string
  inferenceTime: string
  hardware: string
  pricing: string
}

const ModelInfo: React.FC<Props> = ({
  modelName,
  inferenceTime,
  hardware,
  pricing,
}) => (
  <div className="flex flex-col gap-3 rounded-lg border border-gray-200 p-3">
    <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
      {modelName} is available via Jan API
    </h2>
    <div className="flex items-start gap-4">
      <ModelInfoItem description={inferenceTime} name="Inference Time" />
      <ModelInfoItem description={hardware} name="Hardware" />
    </div>
    <hr />
    <div className="flex items-center justify-between ">
      <div className="flex flex-col">
        <h2 className="text-xl font-semibold tracking-[-0.4px]">{pricing}</h2>
        <span className="text-xs leading-[18px] text-[#6B7280]">
          Average Cost / Call
        </span>
      </div>
      <button className="flex items-center gap-2 rounded-lg bg-[#1F2A37] px-3 py-2">
        <Image src={'icons/code.svg'} width={16} height={17} alt="" />
        <span className="text-sm font-medium text-white">Get API Key</span>
      </button>
    </div>
  </div>
)

export default React.memo(ModelInfo)
