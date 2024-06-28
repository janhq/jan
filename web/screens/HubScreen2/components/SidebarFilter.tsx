import { Checkbox } from '@janhq/joi'
import { useAtomValue } from 'jotai'

import { twMerge } from 'tailwind-merge'

import RangeSlider from './DoubleRange'
import Toggle from './Toggle'

import {
  reduceTransparentAtom,
  showSidbarFilterAtom,
} from '@/helpers/atoms/Setting.atom'

const SidebarFilter: React.FC = () => {
  const reduceTransparent = useAtomValue(reduceTransparentAtom)
  const showSidbarFilter = useAtomValue(showSidbarFilterAtom)

  return (
    <div
      className={twMerge(
        'h-full w-[200px] px-4 py-1.5',
        !reduceTransparent ? 'border-l' : 'border-none',
        showSidbarFilter && 'border-none'
      )}
    >
      <span className="text-[var(--text-secondary)]">Filter</span>
      <div className="mt-4 flex items-start justify-start gap-1.5">
        <Toggle />
        <span>Compatible with my device</span>
      </div>
      <span className="mb-3 mt-6 block font-semibold">Format</span>
      <div className="flex flex-col gap-1">
        <Checkbox label="GGUF" />
        <Checkbox label="TensorRT" />
        <Checkbox label="ONNX" />
      </div>
      <span className="mb-3 mt-6 block font-semibold">Model Size</span>
      <RangeSlider />
    </div>
  )
}

export default SidebarFilter
