import { vi } from 'vitest'

// Minimal base class so the extension under test can extend it. The abstract
// members are implemented by the subclass, so an empty class suffices.
class AssistantExtension {}

vi.mock('@janhq/core', () => ({
  AssistantExtension,
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  joinPath: vi.fn((parts: string[]) => parts.join('/')),
  fs: {
    existsSync: vi.fn(),
    mkdir: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    readdirSync: vi.fn(),
    rm: vi.fn(),
  },
}))
