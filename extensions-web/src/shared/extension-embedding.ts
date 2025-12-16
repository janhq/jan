declare const BROWSER_EXTENSION_ID: string

const EXTENSION_ID_PARAM = 'extensionId'
const EMBEDDED_PARAM = 'embedded'
const SETTINGS_STORAGE_KEY = 'setting-general'

export function isInIframe(): boolean {
  try {
    return window !== window.top
  } catch {
    return true
  }
}

export function getExtensionIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const params = new URLSearchParams(window.location.search)
    const extensionId = params.get(EXTENSION_ID_PARAM)
    return extensionId?.trim() || null
  } catch {
    return null
  }
}

export function isEmbedded(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    return params.get(EMBEDDED_PARAM) === 'true' || isInIframe()
  } catch {
    return false
  }
}

export function getExtensionIdFromStorage(): string | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!stored) return null
    const parsed = JSON.parse(stored)
    const id = parsed?.state?.browserExtensionId
    return typeof id === 'string' && id.trim() ? id.trim() : null
  } catch {
    return null
  }
}

export function resolveExtensionId(): string {
  return getExtensionIdFromUrl() ?? getExtensionIdFromStorage() ?? BROWSER_EXTENSION_ID
}

export interface ExtensionEmbeddingInfo {
  isInIframe: boolean
  isEmbedded: boolean
  urlExtensionId: string | null
  extensionId: string
}

export function getExtensionEmbeddingInfo(): ExtensionEmbeddingInfo {
  return {
    isInIframe: isInIframe(),
    isEmbedded: isEmbedded(),
    urlExtensionId: getExtensionIdFromUrl(),
    extensionId: resolveExtensionId(),
  }
}

export type ExtensionMessageType =
  | 'EXTENSION_READY'
  | 'EXTENSION_ID_REQUEST'
  | 'EXTENSION_ID_RESPONSE'
  | 'CONNECTION_STATUS'

export interface ExtensionMessage {
  type: ExtensionMessageType
  source: 'jan-web-app' | 'jan-extension'
  payload?: unknown
}

export function sendMessageToParent(message: ExtensionMessage): void {
  if (!isInIframe()) return
  try {
    window.parent.postMessage(message, '*')
  } catch {
    // Silently fail
  }
}

export function listenForParentMessages(
  callback: (message: ExtensionMessage) => void
): () => void {
  const handler = (event: MessageEvent) => {
    const message = event.data as ExtensionMessage
    if (message?.source === 'jan-extension') {
      callback(message)
    }
  }
  window.addEventListener('message', handler)
  return () => window.removeEventListener('message', handler)
}

export function notifyParentReady(extensionId: string): void {
  sendMessageToParent({
    type: 'EXTENSION_READY',
    source: 'jan-web-app',
    payload: { extensionId },
  })
}

export function requestExtensionIdFromParent(timeoutMs = 3000): Promise<string | null> {
  if (!isInIframe()) return Promise.resolve(null)

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup()
      resolve(null)
    }, timeoutMs)

    const cleanup = listenForParentMessages((message) => {
      if (message.type === 'EXTENSION_ID_RESPONSE') {
        clearTimeout(timeout)
        cleanup()
        resolve((message.payload as { extensionId?: string })?.extensionId ?? null)
      }
    })

    sendMessageToParent({
      type: 'EXTENSION_ID_REQUEST',
      source: 'jan-web-app',
    })
  })
}

export function buildEmbeddedUrl(
  baseUrl: string,
  extensionId?: string,
  params?: Record<string, string>
): string {
  const url = new URL(baseUrl)
  url.searchParams.set(EMBEDDED_PARAM, 'true')
  if (extensionId) url.searchParams.set(EXTENSION_ID_PARAM, extensionId)
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  }
  return url.toString()
}
