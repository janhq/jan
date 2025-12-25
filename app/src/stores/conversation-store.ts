import { create } from 'zustand'
import { conversationService } from '@/services/conversation-service'
import type { UIMessage } from '@ai-sdk/react'
import { convertToUIMessages } from '@/lib/utils'
import { useChatSessions } from './chat-session-store'
import { BRANCH } from '@/constants'

let fetchPromise: Promise<void> | null = null

interface ConversationState {
  conversations: Conversation[]
  loading: boolean
  // Branch state
  branches: ConversationBranch[]
  activeBranch: string
  branchesLoading: boolean
  // Conversation operations
  getConversations: () => Promise<void>
  getConversation: (conversationId: string) => Promise<Conversation>
  getUIMessages: (
    conversationId: string,
    branch?: string
  ) => Promise<UIMessage[]>
  createConversation: (
    payload: CreateConversationPayload
  ) => Promise<Conversation>
  updateConversation: (
    conversationId: string,
    payload: UpdateConversationPayload
  ) => Promise<Conversation>
  deleteConversation: (conversationId: string) => Promise<void>
  deleteAllConversations: () => Promise<void>
  clearConversations: () => void
  moveConversationToTop: (conversationId: string) => void
  // Branch operations
  fetchBranches: (conversationId: string) => Promise<ConversationBranch[]>
  switchBranch: (conversationId: string, branchName: string) => Promise<void>
  createBranch: (
    conversationId: string,
    request: CreateBranchRequest
  ) => Promise<ConversationBranch>
  deleteBranch: (conversationId: string, branchName: string) => Promise<void>
  setActiveBranch: (branchName: string) => void
  // Message actions
  editMessage: (
    conversationId: string,
    itemId: string,
    content: string,
    regenerate?: boolean
  ) => Promise<EditMessageResponse>
  regenerateMessage: (
    conversationId: string,
    itemId: string,
    options?: RegenerateMessageRequest
  ) => Promise<RegenerateMessageResponse>
  deleteMessage: (
    conversationId: string,
    itemId: string
  ) => Promise<DeleteItemResponse>
}

export const useConversations = create<ConversationState>((set, get) => ({
  conversations: [],
  loading: false,
  // Branch state
  branches: [],
  activeBranch: BRANCH.MAIN,
  branchesLoading: false,
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
  getConversation: async (conversationId: string) => {
    try {
      const conversation =
        await conversationService.getConversation(conversationId)
      return conversation
    } catch (err) {
      console.error('Error fetching conversation:', err)
      throw err
    }
  },
  getUIMessages: async (conversationId: string, branch?: string) => {
    try {
      const branchToUse = branch ?? get().activeBranch
      const items = (
        await conversationService.getItems(conversationId, branchToUse)
      ).data
      return convertToUIMessages(items)
    } catch (err) {
      console.error('Error fetching conversation items:', err)
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
    conversationId: string,
    payload: UpdateConversationPayload
  ) => {
    try {
      const updatedConversation = await conversationService.updateConversation(
        conversationId,
        payload
      )
      set((state) => ({
        conversations: state.conversations.map((conv) =>
          conv.id === conversationId ? updatedConversation : conv
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
      useChatSessions.getState().removeSession(conversationId)
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

  deleteAllConversations: async () => {
    try {
      await conversationService.deleteAllConversations()
      useChatSessions.getState().clearSessions()
      set(() => ({
        conversations: [],
      }))
    } catch (err) {
      console.error('Error deleting conversation:', err)
      throw err
    }
  },
  clearConversations: () => {
    useChatSessions.getState().clearSessions()
    set({
      conversations: [],
      loading: false,
      branches: [],
      activeBranch: BRANCH.MAIN,
    })
    fetchPromise = null
  },

  moveConversationToTop: (conversationId: string) => {
    set((state) => {
      const conversation = state.conversations.find(
        (conv) => conv.id === conversationId
      )
      if (!conversation) return state

      const updatedConversation = {
        ...conversation,
        updated_at: Date.now(),
      }

      const otherConversations = state.conversations.filter(
        (conv) => conv.id !== conversationId
      )

      return {
        conversations: [updatedConversation, ...otherConversations],
      }
    })
  },

  // Branch operations
  fetchBranches: async (conversationId: string) => {
    try {
      set({ branchesLoading: true })
      const response = await conversationService.getBranches(conversationId)
      set({ branches: response.data })
      return response.data
    } catch (err) {
      console.error('Error fetching branches:', err)
      throw err
    } finally {
      set({ branchesLoading: false })
    }
  },

  switchBranch: async (conversationId: string, branchName: string) => {
    try {
      await conversationService.activateBranch(conversationId, branchName)
      set({ activeBranch: branchName })
    } catch (err) {
      console.error('Error switching branch:', err)
      throw err
    }
  },

  createBranch: async (
    conversationId: string,
    request: CreateBranchRequest
  ) => {
    try {
      const branch = await conversationService.createBranch(
        conversationId,
        request
      )
      set((state) => ({
        branches: [...state.branches, branch],
      }))
      return branch
    } catch (err) {
      console.error('Error creating branch:', err)
      throw err
    }
  },

  deleteBranch: async (conversationId: string, branchName: string) => {
    try {
      await conversationService.deleteBranch(conversationId, branchName)
      set((state) => ({
        branches: state.branches.filter((b) => b.name !== branchName),
        // If we deleted the active branch, switch to MAIN
        activeBranch:
          state.activeBranch === branchName ? BRANCH.MAIN : state.activeBranch,
      }))
    } catch (err) {
      console.error('Error deleting branch:', err)
      throw err
    }
  },

  setActiveBranch: (branchName: string) => {
    set({ activeBranch: branchName })
  },

  // Message actions
  editMessage: async (
    conversationId: string,
    itemId: string,
    content: string,
    regenerate = true
  ) => {
    try {
      const response = await conversationService.editMessage(
        conversationId,
        itemId,
        content,
        regenerate
      )
      // If a new branch was created, add it to the list and switch to it
      if (response.branch_created && response.new_branch) {
        set((state) => ({
          branches: [...state.branches, response.new_branch!],
          activeBranch: response.branch,
        }))
      }
      return response
    } catch (err) {
      console.error('Error editing message:', err)
      throw err
    }
  },

  regenerateMessage: async (
    conversationId: string,
    itemId: string,
    options?: RegenerateMessageRequest
  ) => {
    try {
      const response = await conversationService.regenerateMessage(
        conversationId,
        itemId,
        options
      )
      // If a new branch was created, add it to the list and switch to it
      if (response.branch_created && response.new_branch) {
        set((state) => ({
          branches: [...state.branches, response.new_branch!],
          activeBranch: response.branch,
        }))
      }
      return response
    } catch (err) {
      console.error('Error regenerating message:', err)
      throw err
    }
  },

  deleteMessage: async (conversationId: string, itemId: string) => {
    try {
      const response = await conversationService.deleteMessage(
        conversationId,
        itemId
      )
      return response
    } catch (err) {
      console.error('Error deleting message:', err)
      throw err
    }
  },
}))
