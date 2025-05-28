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
    'Jan is a helpful desktop assistant that can reason through complex tasks and use tools to complete them on the user’s behalf. Respond naturally and concisely, take actions when needed, and guide the user toward their goals.',
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
