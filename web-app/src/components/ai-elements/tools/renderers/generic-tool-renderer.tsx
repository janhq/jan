import type { ToolPresentation } from '@/lib/tools/types'
import { ToolInput, ToolOutput } from '../tool'

type GenericToolRendererProps = {
  presentation: Extract<ToolPresentation, { kind: 'generic' }>
}

export function GenericToolRenderer({
  presentation,
}: GenericToolRendererProps) {
  const { input, output, errorText } = presentation

  return (
    <div className="space-y-4">
      {input !== undefined && <ToolInput input={input} />}

      <ToolOutput
        output={output}
        errorText={errorText}
        resolver={(value) => Promise.resolve(value)}
      />
    </div>
  )
}
