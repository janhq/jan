import { create } from 'zustand'
import { conversationService } from '@/services/conversation-service'
import type { UIMessage } from '@ai-sdk/react'
import { convertToUIMessages } from '@/lib/utils'

let fetchPromise: Promise<void> | null = null

interface ConversationState {
  conversations: Conversation[]
  loading: boolean
  getConversations: () => Promise<void>
  getConversation: (conversationId: string) => Promise<Conversation>
  getUIMessages: (conversationId: string) => Promise<UIMessage[]>
  createConversation: (
    payload: CreateConversationPayload
  ) => Promise<Conversation>
  updateConversation: (
    convId: string,
    payload: CreateConversationPayload
  ) => Promise<Conversation>
  deleteConversation: (conversationId: string) => Promise<void>
}

export const useConversations = create<ConversationState>((set, get) => ({
  conversations: [],
  loading: false,
  getConversations: async () => {
    if (fetchPromise) {
      return fetchPromise
    }
    if (get().conversations.length > 0) {
      return
    }
    fetchPromise = (async () => {
      try {
        set({ loading: true })
        const data = await conversationService.getConversations()
        set({ conversations: data.data })
      } catch (err) {
        console.error('Error fetching conversations:', err)
      } finally {
        set({ loading: false })
        fetchPromise = null
      }
    })()
  },
  getUIMessages: async (conversationId: string) => {
    try {
      const items = (await conversationService.getItems(conversationId)).data
      return convertToUIMessages(items)
    } catch (err) {
      console.error('Error fetching conversation items:', err)
      throw err
    }
  },
  getConversation: async (conversationId: string) => {
    try {
      const conversation =
        await conversationService.getConversation(conversationId)
      set((state) => {
        const existingIndex = state.conversations.findIndex(
          (conv) => conv.id === conversationId
        )
        if (existingIndex !== -1) {
          const updatedConversations = [...state.conversations]
          updatedConversations[existingIndex] = conversation
          return { conversations: updatedConversations }
        } else {
          return { conversations: [...state.conversations, conversation] }
        }
      })
      return conversation
    } catch (err) {
      console.error('Error fetching conversation:', err)
      throw err
    }
  },
  createConversation: async (payload: CreateConversationPayload) => {
    try {
      const newConversation =
        await conversationService.createConversation(payload)
      set((state) => ({
        conversations: [newConversation, ...state.conversations],
      }))
      return newConversation
    } catch (err) {
      console.error('Error creating conversation:', err)
      throw err
    }
  },
  updateConversation: async (
    convId: string,
    payload: CreateConversationPayload
  ) => {
    try {
      const updatedConversation = await conversationService.updateConversation(
        convId,
        payload
      )
      set((state) => ({
        conversations: state.conversations.map((conv) =>
          conv.id === updatedConversation.id ? updatedConversation : conv
        ),
      }))
      return updatedConversation
    } catch (err) {
      console.error('Error updating conversation:', err)
      throw err
    }
  },
  deleteConversation: async (conversationId: string) => {
    try {
      await conversationService.deleteConversation(conversationId)
      set((state) => ({
        conversations: state.conversations.filter(
          (conv) => conv.id !== conversationId
        ),
      }))
    } catch (err) {
      console.error('Error deleting conversation:', err)
      throw err
    }
  },
}))
