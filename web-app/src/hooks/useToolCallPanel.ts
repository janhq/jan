import { create } from 'zustand'
import { useLeftPanel } from './useLeftPanel'

interface ToolCallData {
  id: number
  name: string
  args: object
  result: string
}

interface MessageData {
  id: string
  content: string
  role: 'assistant' | 'user'
  metadata?: Record<string, unknown>
}

interface ThinkingData {
  id: string
  content: string
}

interface MermaidData {
  id: string
  code: string
  title?: string
}

type PanelData =
  | { type: 'tool_call'; data: ToolCallData }
  | { type: 'message'; data: MessageData }
  | { type: 'thinking'; data: ThinkingData }
  | { type: 'mermaid'; data: MermaidData }

interface ToolCallPanelState {
  isOpen: boolean
  panelData: PanelData | null
  openPanel: (data: PanelData) => void
  closePanel: () => void
}

export const useToolCallPanel = create<ToolCallPanelState>((set) => ({
  isOpen: false,
  panelData: null,
  openPanel: (data) => {
    // Close left panel when opening tool panel
    const leftPanelState = useLeftPanel.getState()
    if (leftPanelState.open) {
      leftPanelState.setLeftPanel(false)
    }

    set({
      isOpen: true,
      panelData: data,
    })
  },
  closePanel: () =>
    set({
      isOpen: false,
      panelData: null,
    }),
}))

// Export types for use in other components
export type { ToolCallData, MessageData, ThinkingData, MermaidData, PanelData }
