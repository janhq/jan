import { isToolOrDynamicToolUIPart, type UIMessage } from "ai";

export function lastAssistantMessageIsCompleteWithToolCalls({
  messages,
}: {
  messages: UIMessage[];
}): boolean {
  const message = messages[messages.length - 1];

  if (!message) {
    return false;
  }

  if (message.role !== 'assistant') {
    return false;
  }

  const lastStepStartIndex = message.parts.reduce((lastIndex, part, index) => {
    return part.type === 'step-start' ? index : lastIndex;
  }, -1);

  const lastStepToolInvocations = message.parts
    .slice(lastStepStartIndex + 1)
    .filter(isToolOrDynamicToolUIPart)
    .filter(part => !part.providerExecuted);
  return (
    lastStepToolInvocations.length > 0 &&
    lastStepToolInvocations.every(
      part =>
        part.state === 'output-available' || part.state === 'output-error',
    )
  );
}