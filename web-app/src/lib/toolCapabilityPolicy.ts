/** Advertisement decisions only; schemas, ordering, freezing and dispatch stay
 * with their existing owners. Native schemas are already sandbox-filtered by
 * getAgentToolSchemas. Dynamic MCP/RAG names are deliberately not classified. */
export const CHAT_AGENT_TOOL_NAMES = new Set(['shell'])

export const PLAN_DENIED_TOOLS = new Set([
  'write',
  'edit',
  'shell',
  'skill_write',
  'task',
  // Starting a monitor schedules shell scripts, which is exec-class work.
  // Keep this pure module independent of schemas; a test binds the name to
  // coworkMonitor's exported identity.
  'monitor',
])

type ToolCapabilityInput =
  | {
      surface: 'chat'
      modelSupportsTools: boolean
      shellEnabled: boolean
      webSearch: boolean
    }
  | {
      surface: 'cowork'
      planMode: boolean
      allowSubagents: boolean
      webSearch: boolean
    }

/** No settings reads or new defaults: callers supply their existing snapshot.
 * Cowork's model gate remains at send time, unlike Chat's builder-level gate. */
export function resolveToolCapabilities(input: ToolCapabilityInput) {
  if (input.surface === 'chat') {
    return {
      loadNativeTools: input.modelSupportsTools && input.shellEnabled,
      allowsNativeTool: (name: string) =>
        input.modelSupportsTools &&
        input.shellEnabled &&
        CHAT_AGENT_TOOL_NAMES.has(name),
      webSearch: input.modelSupportsTools && input.webSearch,
      task: false,
      monitor: false,
    }
  }
  return {
    loadNativeTools: true,
    allowsNativeTool: (name: string) =>
      !(input.planMode && PLAN_DENIED_TOOLS.has(name)),
    webSearch: input.webSearch,
    task: !input.planMode && input.allowSubagents,
    monitor: !input.planMode,
  }
}
