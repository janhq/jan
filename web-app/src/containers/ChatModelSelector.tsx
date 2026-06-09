import DropdownModelProvider from '@/containers/DropdownModelProvider'

type ChatModelSelectorProps = {
  model?: ThreadModel
  useLastUsedModel?: boolean
}

/**
 * Shared chat-bar model selector for local and remote providers.
 */
export function ChatModelSelector({
  model,
  useLastUsedModel = false,
}: ChatModelSelectorProps) {
  return (
    <DropdownModelProvider
      model={model}
      useLastUsedModel={useLastUsedModel}
      compact
      popupSide="top"
      popupAlign="end"
      showSettings={false}
      showSupportStatus={false}
      showReasoning
    />
  )
}