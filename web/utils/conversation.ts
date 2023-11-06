export const generateConversationId = () => {
  return `jan-${(Date.now() / 1000).toFixed(0)}`
}
