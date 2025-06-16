import { createAssistant, deleteAssistant } from '@/services/assistants'
import { Assistant as CoreAssistant } from '@janhq/core'
import { create } from 'zustand'

interface AssistantState {
  assistants: Assistant[]
  currentAssistant: Assistant
  addAssistant: (assistant: Assistant) => void
  updateAssistant: (assistant: Assistant) => void
  deleteAssistant: (id: string) => void
  setCurrentAssistant: (assistant: Assistant) => void
  setAssistants: (assistants: Assistant[]) => void
}

export const defaultAssistant: Assistant = {
  id: 'jan',
  name: 'Jan',
  created_at: 1747029866.542,
  parameters: {},
  avatar: '👋',
  description:
    'Jan is a helpful desktop assistant that can reason through complex tasks and use tools to complete them on the user’s behalf.',
  instructions:
    'You have access to a set of tools to help you answer the user’s question. You can use only one tool per message, and you’ll receive the result of that tool in the user’s next response. To complete a task, use tools step by step—each step should be guided by the outcome of the previous one.\nTool Usage Rules:\n1. Always provide the correct values as arguments when using tools. Do not pass variable names—use actual values instead.\n2. You may perform multiple tool steps to complete a task.\n3. Avoid repeating a tool call with exactly the same parameters to prevent infinite loops.',
}

export const useAssistant = create<AssistantState>()((set, get) => ({
  assistants: [defaultAssistant],
  currentAssistant: defaultAssistant,
  addAssistant: (assistant) => {
    set({ assistants: [...get().assistants, assistant] })
    createAssistant(assistant as unknown as CoreAssistant).catch((error) => {
      console.error('Failed to create assistant:', error)
    })
  },
  updateAssistant: (assistant) => {
    const state = get()
    set({
      assistants: state.assistants.map((a) =>
        a.id === assistant.id ? assistant : a
      ),
      // Update currentAssistant if it's the same assistant being updated
      currentAssistant:
        state.currentAssistant.id === assistant.id
          ? assistant
          : state.currentAssistant,
    })
    // Create assistant already cover update logic
    createAssistant(assistant as unknown as CoreAssistant).catch((error) => {
      console.error('Failed to update assistant:', error)
    })
  },
  deleteAssistant: (id) => {
    deleteAssistant(
      get().assistants.find((e) => e.id === id) as unknown as CoreAssistant
    ).catch((error) => {
      console.error('Failed to delete assistant:', error)
    })
    set({ assistants: get().assistants.filter((a) => a.id !== id) })
  },
  setCurrentAssistant: (assistant) => {
    set({ currentAssistant: assistant })
  },
  setAssistants: (assistants) => {
    set({ assistants })
  },
}))
