import { vi } from 'vitest'

vi.mock('@janhq/tauri-plugin-rag-api', () => ({
  parseDocument: vi.fn(),
}))

// The embedding helpers run for real against this engine registry: they are
// the shared implementation this extension delegates to, so stubbing them
// would leave the delegation untested on both sides.
window.core = { engineManager: { get: vi.fn() } }
