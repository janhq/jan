export const OPENUI_CHAT_ACTION_EVENT = 'jan:openui-chat-action'

export type OpenUIChatActionDetail = {
  prompt: string
}

export function dispatchOpenUIChatAction(prompt: string) {
  if (typeof window === 'undefined') return false

  const event = new CustomEvent<OpenUIChatActionDetail>(
    OPENUI_CHAT_ACTION_EVENT,
    {
      detail: { prompt },
      cancelable: true,
    }
  )

  return !window.dispatchEvent(event)
}

export function isOpenUIChatActionEvent(
  event: Event
): event is CustomEvent<OpenUIChatActionDetail> {
  return (
    event.type === OPENUI_CHAT_ACTION_EVENT &&
    'detail' in event &&
    typeof (event as CustomEvent<OpenUIChatActionDetail>).detail?.prompt ===
      'string'
  )
}

function escapeXmlText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function wrapOpenUIActionMessage(
  prompt: string,
  context: Array<unknown>
) {
  if (context.length === 0) return prompt

  return `<content>${escapeXmlText(prompt)}</content><context>${JSON.stringify(context)}</context>`
}
