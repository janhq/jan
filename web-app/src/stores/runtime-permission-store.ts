import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

export type RuntimePermissionCategory = 'shell' | 'browser' | 'file' | 'app'

export type RuntimePermissionRisk = 'low' | 'medium' | 'high'

export type RuntimePermissionDecision = 'allow-once' | 'allow-always' | 'deny'

export type RuntimePermissionAuditDecision =
  | RuntimePermissionDecision
  | 'auto-allow'

export type RuntimePermissionRequest = {
  id: string
  actionId: string
  actionLabel: string
  category: RuntimePermissionCategory
  resourceLabel?: string
  details?: Record<string, unknown>
  risk?: RuntimePermissionRisk
  rememberKey?: string
}

type PendingRuntimePermission = RuntimePermissionRequest & {
  resolve: (allowed: boolean) => void
}

type RuntimePermissionState = {
  remembered: Record<string, true>
  audit: RuntimePermissionAuditEntry[]
  pending: PendingRuntimePermission | null
  requestPermission: (
    request: Omit<RuntimePermissionRequest, 'id'>
  ) => Promise<boolean>
  resolvePermission: (decision: RuntimePermissionDecision) => void
  revokeRemembered: (rememberKey: string) => void
  clearRemembered: () => void
  clearAudit: () => void
  isRemembered: (rememberKey: string) => boolean
}

export type RuntimePermissionAuditEntry = {
  id: string
  actionId: string
  actionLabel: string
  category: RuntimePermissionCategory
  resourceLabel?: string
  risk?: RuntimePermissionRisk
  rememberKey?: string
  decision: RuntimePermissionAuditDecision
  decidedAt: number
}

const createRequestId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`

const getRememberKey = (request: Omit<RuntimePermissionRequest, 'id'>) =>
  request.rememberKey ?? `${request.category}:${request.actionId}`

export const useRuntimePermission = create<RuntimePermissionState>()(
  persist(
    (set, get) => ({
      remembered: {},
      audit: [],
      pending: null,

      requestPermission: (request) => {
        const rememberKey = getRememberKey(request)
        if (get().remembered[rememberKey]) {
          const id = createRequestId()
          const entry: RuntimePermissionAuditEntry = {
            id,
            actionId: request.actionId,
            actionLabel: request.actionLabel,
            category: request.category,
            resourceLabel: request.resourceLabel,
            risk: request.risk,
            rememberKey,
            decision: 'auto-allow',
            decidedAt: Date.now(),
          }
          set((state) => ({
            audit: [entry, ...state.audit].slice(0, 50),
          }))
          return Promise.resolve(true)
        }

        return new Promise<boolean>((resolve) => {
          get().pending?.resolve(false)
          set({
            pending: {
              ...request,
              id: createRequestId(),
              rememberKey,
              resolve,
            },
          })
        })
      },

      resolvePermission: (decision) => {
        const pending = get().pending
        if (!pending) return

        if (decision === 'allow-always' && pending.rememberKey) {
          set((state) => ({
            remembered: {
              ...state.remembered,
              [pending.rememberKey!]: true,
            },
          }))
        }

        set((state) => ({
          pending: null,
          audit: [
            {
              id: pending.id,
              actionId: pending.actionId,
              actionLabel: pending.actionLabel,
              category: pending.category,
              resourceLabel: pending.resourceLabel,
              risk: pending.risk,
              rememberKey: pending.rememberKey,
              decision,
              decidedAt: Date.now(),
            },
            ...state.audit,
          ].slice(0, 50),
        }))
        pending.resolve(decision !== 'deny')
      },

      revokeRemembered: (rememberKey) => {
        set((state) => {
          const remembered = { ...state.remembered }
          delete remembered[rememberKey]
          return { remembered }
        })
      },

      clearRemembered: () => set({ remembered: {} }),

      clearAudit: () => set({ audit: [] }),

      isRemembered: (rememberKey) => Boolean(get().remembered[rememberKey]),
    }),
    {
      name: localStorageKey.runtimePermissions,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        remembered: state.remembered,
        audit: state.audit,
      }),
    }
  )
)
