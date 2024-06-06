import { useState } from 'react'

import { ChevronDown } from 'lucide-react'

const FormatSelect: React.FC = () => {
  const [format, setFormat] = useState<string[]>([
    'GGUF',
    'ONNX',
    'TensorRT-LLM',
  ])
  const checkBoxes = ['GGUF', 'ONNX', 'TensorRT-LLM']
  const [show, setShow] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={() => setShow(!show)}
        className="relative flex h-8 items-center gap-1.5 rounded-md border px-4 py-2 text-sm leading-[16.94px]"
      >
        <span className="text-[var(--text-secondary)]">Select:</span>
        <span className="font-semibold">
          {format.length === checkBoxes.length ? 'ALL' : format.join(', ')}
        </span>
        <ChevronDown />
      </button>
      {show && (
        <div className="absolute left-0 top-9 z-10 flex flex-col justify-start rounded-md border bg-white p-1 shadow-dropDown">
          {checkBoxes.map((item) => (
            <div
              className="flex items-center gap-2 whitespace-nowrap px-2 py-1"
              key={item}
            >
              <input
                className="h-[14px] w-[14px] rounded-[5px]"
                type="checkbox"
                id={item}
                name={item}
                checked={format.includes(item)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setFormat([...format, item])
                  } else {
                    setFormat(format.filter((f) => f !== item))
                  }
                }}
              />
              <label className="font-medium" htmlFor={item}>
                {item}
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default FormatSelect
