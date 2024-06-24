import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

import { Select } from '@janhq/joi'
import { Download } from 'lucide-react'
import { ChevronDown } from 'lucide-react'

import useHuggingFace, {
  EngineToBranches,
  EngineType,
} from '@/hooks/useHuggingFace'

type Props = {
  modelHandle: string
}

// TODO: handle loading indicator
const ListModel: React.FC<Props> = ({ modelHandle }) => {
  const { getEngineAndBranches } = useHuggingFace()

  const [engineAndBranches, setEngineAndBranches] = useState<
    EngineToBranches | undefined
  >(undefined)
  const [engineFilter, setEngineFilter] = useState<EngineType | undefined>(
    undefined
  )
  const [showModel, setShowModel] = useState<number | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fetchData = async () => {
      const result = await getEngineAndBranches(modelHandle)
      setEngineAndBranches(result)
    }
    fetchData()
  }, [getEngineAndBranches, modelHandle])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        event.target instanceof Node &&
        !dropdownRef.current.contains(event.target)
      ) {
        setShowModel(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [dropdownRef])

  const engineSelection: { name: string; value: string }[] = useMemo(() => {
    if (!engineAndBranches) return []
    const result: { name: string; value: string }[] = []
    if (engineAndBranches.gguf.length > 0)
      result.push({ name: 'GGUF', value: 'gguf' })
    if (engineAndBranches.onnx.length > 0)
      result.push({ name: 'ONNX', value: 'onnx' })
    if (engineAndBranches.tensorrtllm.length > 0)
      result.push({ name: 'TensorRT', value: 'tensorrtllm' })

    return result
  }, [engineAndBranches])

  useEffect(() => {
    if (engineSelection.length === 0) return
    setEngineFilter(engineSelection[0].value as EngineType)
  }, [engineSelection])

  const modelBranches: string[] = []
  if (engineAndBranches) {
    const branches = engineAndBranches[engineFilter as EngineType] as string[]
    if (!branches || branches.length === 0) return
    modelBranches.push(...branches)
  }

  return (
    <Fragment>
      <div className="mt-6 flex items-center gap-2">
        <span>Format:</span>
        <Select
          value={engineFilter}
          className="gap-1.5 whitespace-nowrap px-4 py-2 font-semibold"
          options={engineSelection}
          onValueChange={(value) => setEngineFilter(value as EngineType)}
        />
      </div>
      <div className="mt-3 rounded-md border">
        {modelBranches.map((item, index) => (
          <div
            className="relative flex items-center justify-between border-b p-3 last:border-b-0"
            key={item}
          >
            <div className="flex items-center gap-2">
              <div className="rounded-[5px] bg-[#2563EB33] px-1.5 py-0.5 text-xs text-[hsla(var(--app-link))]">
                {/* {item.type} */}
              </div>
              <div className="rounded-[5px] bg-[#0000000F] px-1.5 py-0.5 text-xs">
                {item}
              </div>
              <span>{item}</span>
            </div>
            <div className="flex items-center justify-end gap-2 text-xs text-[hsla(var(--text-secondary))]">
              {/* {item.status !== '' && ( */}
              {/*   <Info */}
              {/*     size={16} */}
              {/*     className={`${item.status === 'warning' ? 'text-yellow-300' : 'text-red-300'} `} */}
              {/*   /> */}
              {/* )} */}
              <div className="flex items-center gap-1">
                {item} <Download size={16} />
              </div>
              <span>{item}</span>
              <div className="flex items-center justify-center">
                <button className="rounded-l-md bg-[#0000000F] px-3 py-2 font-semibold leading-[14.52px]">
                  Download
                </button>
                <button
                  onClick={() =>
                    setShowModel(showModel === index ? null : index)
                  }
                  className="flex flex-1 items-center justify-center rounded-r-md border-l bg-[#0000000F] px-3 py-2"
                >
                  <ChevronDown size={14} />
                </button>
              </div>
              {showModel === index && (
                <div
                  ref={dropdownRef}
                  className="absolute right-3 top-[85%] z-10"
                >
                  <div className="rounded-lg border bg-white p-1 shadow-xl">
                    {Array(6)
                      .fill(0)
                      .map((_, idx) => (
                        <div className="flex items-center gap-2 p-2" key={idx}>
                          <img
                            className="h-4 w-4 rounded-full"
                            src="https://i.pinimg.com/564x/08/ea/94/08ea94ca94a4b3a04037bdfc335ae00d.jpg"
                            alt=""
                          />
                          <span className="text-md whitespace-nowrap">
                            Jan on Hugging Face
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Fragment>
  )
}

export default ListModel
