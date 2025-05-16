type ToolCall = {
  tool: {
    id?: number
    function?: {
      name?: string
    }
  }
  response?: unknown
  state?: string
}
