import type { OpenUIComponentLibrary } from '@/hooks/useOpenUISettings'
import {
  janOpenUIChatLibrary,
  janOpenUIChatPromptOptions,
} from '@/lib/openui-chat-library'

const JAN_OPENUI_RULES = (componentLibrary: OpenUIComponentLibrary) => `

Jan OpenUI integration rules:
- Prefer the ${componentLibrary} component library and do not invent component names.
- Do not use Query() or Mutation() for external data access unless the user explicitly asks for a data-driven UI.
- Prefer Button and FollowUpBlock for chat CTAs. If you use ListItem as a CTA, include an Action with a ToAssistant step so Jan can submit it when clicked.
- Keep responses compact enough to fit comfortably inside a chat message.`

export async function getOpenUISystemPrompt(
  componentLibrary: OpenUIComponentLibrary
) {
  if (componentLibrary === 'standard') {
    const { openuiLibrary, openuiPromptOptions } = await import(
      '@openuidev/react-ui/genui-lib'
    )
    return `${openuiLibrary.prompt(openuiPromptOptions)}${JAN_OPENUI_RULES(componentLibrary)}`
  }

  return `${janOpenUIChatLibrary.prompt(janOpenUIChatPromptOptions)}${JAN_OPENUI_RULES(componentLibrary)}`
}

export async function addOpenUIToSystemPrompt(
  systemPrompt: string | undefined,
  settings: {
    enabled: boolean
    componentLibrary: OpenUIComponentLibrary
  }
) {
  if (!settings.enabled) return systemPrompt

  const openUIPrompt = await getOpenUISystemPrompt(settings.componentLibrary)
  return systemPrompt ? `${systemPrompt}\n\n${openUIPrompt}` : openUIPrompt
}
