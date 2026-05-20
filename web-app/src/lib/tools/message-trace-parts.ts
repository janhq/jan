import type { UIMessage } from 'ai'
import { TraceBlock } from './types'
import { presentTool } from './registry'

export function buildTraceBlocks(
  message: UIMessage,
  disableReasoning: boolean
): TraceBlock[] {
  const blocks: TraceBlock[] = []

  for (let i = 0; i < message.parts.length; i++) {
    const part = message.parts[i]

    if (part.type === 'text') {
      if (part.text?.trim()) {
        blocks.push({
          kind: 'text',
          key: `${message.id}-${i}`,
          text: part.text,
        })
      }
      continue
    }

    if (part.type === 'reasoning') {
      if (!disableReasoning && part.text?.trim()) {
        blocks.push({
          kind: 'reasoning',
          key: `${message.id}-${i}`,
          text: part.text,
        })
      }
      continue
    }

    if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
      const toolName = part.type.slice('tool-'.length)
      const state = 'state' in part ? part.state : 'output-available'
      const input = 'input' in part ? part.input : undefined
      const output = 'output' in part ? part.output : undefined
      const errorText =
        'errorText' in part
          ? part.errorText
          : 'error' in part
            ? String(part.error)
            : undefined

      blocks.push({
        kind: 'tool',
        key: `${message.id}-${i}`,
        toolName,
        state,
        presentation: presentTool({
          toolName,
          input,
          output,
          errorText,
          state,
        }),
      })
    }
  }

  return blocks
}
