import { ChevronDown, ChevronUp, Loader } from 'lucide-react'
import { cn } from '@/lib/utils'
import { create } from 'zustand'
import { RenderMarkdown } from './RenderMarkdown'

interface Props {
  result: string
  name: string
  id: number
  loading: boolean
}

type ToolCallBlockState = {
  collapseState: { [id: number]: boolean }
  setCollapseState: (id: number, expanded: boolean) => void
}

const useToolCallBlockStore = create<ToolCallBlockState>((set) => ({
  collapseState: {},
  setCollapseState: (id, expanded) =>
    set((state) => ({
      collapseState: {
        ...state.collapseState,
        [id]: expanded,
      },
    })),
}))

const ToolCallBlock = ({ id, name, result, loading }: Props) => {
  const { collapseState, setCollapseState } = useToolCallBlockStore()
  const isExpanded = collapseState[id] ?? false

  const handleClick = () => {
    const newExpandedState = !isExpanded
    setCollapseState(id, newExpandedState)
  }

  return (
    <div className="mx-auto w-full cursor-pointer mt-4" onClick={handleClick}>
      <div className="mb-4 rounded-lg bg-main-view-fg/4 border border-dashed border-main-view-fg/10">
        <div className="flex items-center gap-3 p-2">
          {loading && (
            <Loader className="size-4 animate-spin text-main-view-fg/60" />
          )}
          <button className="flex items-center gap-2 focus:outline-none">
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
            <span className="font-medium text-main-view-fg/80">
              View result from{' '}
              <span className="font-medium text-main-view-fg">{name}</span>
            </span>
          </button>
        </div>

        <div
          className={cn(
            'h-fit w-full overflow-auto transition-all duration-300 px-2',
            isExpanded ? '' : 'max-h-0 overflow-hidden'
          )}
        >
          <div className="mt-2 text-main-view-fg/60">
            <RenderMarkdown
              content={
                '```json\n' +
                JSON.stringify(result ? JSON.parse(result) : null, null, 2) +
                '\n```'
              }
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default ToolCallBlock
