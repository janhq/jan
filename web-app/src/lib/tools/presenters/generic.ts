import type { ToolPresentation } from '../types'

export function presentGenericTool(args: {
  toolName: string
  input?: unknown
  output?: unknown
  errorText?: string
}): ToolPresentation {
  return {
    kind: 'generic',
    title: `Used ${args.toolName.replaceAll('_', ' ')}`,
    input: args.input,
    output: args.output,
    errorText: args.errorText,
  }
}
