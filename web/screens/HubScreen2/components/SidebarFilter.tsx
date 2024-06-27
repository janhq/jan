import { Checkbox } from '@janhq/joi'

import RangeSlider from './DoubleRange'
import Toggle from './Toggle'

const SidebarFilter: React.FC = () => {
  return (
    <div className="h-full w-[200px] px-4 py-1.5">
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
