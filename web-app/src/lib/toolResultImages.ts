import { type UIMessage } from '@ai-sdk/react'

import { downscaleImageDataUrl } from './imageDownscale'

/**
 * Tool results (especially MCP image tools such as Blender's
 * `get_viewport_screenshot`) can carry full-resolution images. Two problems
 * follow for local models (MLX / llama.cpp), see ATO-208/ATO-170/ATO-10:
 *
 *  1. The image base64 is never downscaled (the "Max image size" guard only
 *     runs on user-uploaded attachments), so a single screenshot is huge.
 *  2. The AI SDK serializes a tool result into a `role: "tool"` message via
 *     `JSON.stringify(content)` — i.e. the entire base64 is sent to the model
 *     as TEXT, tokenized in full. On a default 4096-token MLX context this
 *     instantly overflows and the next request 400s.
 *
 * This module addresses both:
 *  - {@link downscaleToolResultContent} shrinks image blocks at ingest time so
 *    the stored history / UI preview stays reasonable.
 *  - {@link prepareToolResultImagesForModel} strips the base64 out of the
 *    model-bound copy (replacing it with a short placeholder) and, for
 *    vision-capable models, re-attaches the image as a proper multimodal
 *    `image_url` user message so the model can actually see it.
 */

type UnknownRecord = Record<string, unknown>

const isImageBlock = (block: unknown): block is UnknownRecord =>
  !!block &&
  typeof block === 'object' &&
  (block as UnknownRecord).type === 'image'

/**
 * Read the base64 payload + mime type from an MCP-style image block. Handles
 * both `{ data: "<base64>" }`, `{ data: "data:...;base64,..." }`, and the
 * `{ image: { url } }` variant some servers emit.
 */
const readImageBlock = (
  block: UnknownRecord
): { base64: string; mimeType: string } => {
  const mimeType =
    typeof block.mimeType === 'string' && block.mimeType.length > 0
      ? block.mimeType
      : 'image/png'

  let raw = ''
  if (typeof block.data === 'string') {
    raw = block.data
  } else if (
    block.image &&
    typeof (block.image as UnknownRecord).url === 'string'
  ) {
    raw = (block.image as UnknownRecord).url as string
  }

  const base64 =
    raw.startsWith('data:') && raw.includes(',')
      ? raw.slice(raw.indexOf(',') + 1)
      : raw

  return { base64, mimeType }
}

/**
 * Downscale image blocks inside a tool result's `content` array so oversized
 * screenshots don't bloat persisted history or the in-chat preview. Mirrors the
 * "Max image size" handling applied to user uploads. Returns the original
 * reference when nothing changed (or when `content` is not an array).
 */
export async function downscaleToolResultContent(
  content: unknown,
  maxDimensionPx: number
): Promise<unknown> {
  if (!Array.isArray(content)) return content

  let changed = false
  const out = await Promise.all(
    content.map(async (block) => {
      if (!isImageBlock(block)) return block
      if (typeof block.data !== 'string' || block.data.length === 0) {
        return block
      }
      const mimeType =
        typeof block.mimeType === 'string' && block.mimeType.length > 0
          ? block.mimeType
          : 'image/png'
      const dataUrl = block.data.startsWith('data:')
        ? block.data
        : `data:${mimeType};base64,${block.data}`

      const downscaled = await downscaleImageDataUrl(
        dataUrl,
        maxDimensionPx,
        mimeType
      )
      if (!downscaled) return block

      changed = true
      return { ...block, data: downscaled.base64, mimeType: downscaled.mimeType }
    })
  )

  return changed ? out : content
}

type HoistedImage = { mediaType: string; dataUrl: string }

const partType = (part: unknown): string => {
  const t = (part as UnknownRecord)?.type
  return typeof t === 'string' ? t : ''
}

/**
 * Produce a model-bound copy of `messages` where image blocks inside tool
 * results are removed from the text payload (replaced by a compact placeholder)
 * so they cannot flood the context window. For vision-capable models the
 * removed images are re-attached as an `image_url` user message immediately
 * after the tool turn so the model can still see them.
 *
 * Non-tool messages and tool results without images are returned by reference.
 * Intended for local providers; cloud providers are left untouched by the
 * caller to avoid changing their (large-context) behavior.
 */
export function prepareToolResultImagesForModel(
  messages: UIMessage[],
  opts: { supportsVision: boolean }
): UIMessage[] {
  const result: UIMessage[] = []

  for (const message of messages) {
    const parts = Array.isArray(message.parts) ? message.parts : []
    const hoisted: HoistedImage[] = []
    let changed = false

    const newParts = parts.map((part) => {
      const type = partType(part)
      if (!type.startsWith('tool-')) return part

      const p = part as UnknownRecord
      const outKey =
        p.output !== undefined
          ? 'output'
          : p.result !== undefined
            ? 'result'
            : null
      if (!outKey) return part

      const output = p[outKey]
      if (!Array.isArray(output)) return part

      const toolName = type.slice('tool-'.length)
      let blockChanged = false

      const newOutput = output.map((block) => {
        if (!isImageBlock(block)) return block
        const { base64, mimeType } = readImageBlock(block)
        if (!base64) return block

        blockChanged = true
        if (opts.supportsVision) {
          hoisted.push({
            mediaType: mimeType,
            dataUrl: `data:${mimeType};base64,${base64}`,
          })
          return {
            type: 'text',
            text: `[Image returned by tool "${toolName}" — attached below.]`,
          }
        }
        return {
          type: 'text',
          text: `[Image returned by tool "${toolName}" omitted to conserve context; this model cannot view tool-result images.]`,
        }
      })

      if (!blockChanged) return part
      changed = true
      return { ...p, [outKey]: newOutput }
    })

    if (changed) {
      result.push({ ...message, parts: newParts } as UIMessage)
    } else {
      result.push(message)
    }

    if (hoisted.length > 0) {
      result.push({
        id: `${message.id ?? 'msg'}_toolimg`,
        role: 'user',
        parts: [
          {
            type: 'text',
            text: 'Image result(s) from the preceding tool call(s):',
          },
          ...hoisted.map((img) => ({
            type: 'file',
            mediaType: img.mediaType,
            url: img.dataUrl,
          })),
        ],
      } as unknown as UIMessage)
    }
  }

  return result
}
