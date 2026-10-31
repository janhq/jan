import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// jsdom does not lay out Radix portals. Guard the constraints on each actual
// caller here; native QA verifies collision positioning and visible truncation.
describe('assistant menu portal width constraints', () => {
  it.each(['ChatInput', 'AssistantSwitcher', 'SamplerPopover'])(
    '%s bounds the assistant portal, not only the rows',
    (caller) => {
      const workspace = existsSync(resolve(process.cwd(), 'web-app/src/containers'))
        ? resolve(process.cwd(), 'web-app')
        : process.cwd()
      const source = readFileSync(resolve(workspace, 'src/containers', `${caller}.tsx`), 'utf8')
      const content = source.match(/<DropdownMenu(?:Sub)?Content\b[^>]*>\s*<AssistantsMenu/s)?.[0]
      expect(content).toBeDefined()
      expect(content).toContain('min-w-0')
      expect(content).toContain('w-[min(320px,calc(100vw-16px),var(--radix-dropdown-menu-content-available-width))]')
      expect(content).toContain('max-h-64')
      expect(content).toContain('overflow-y-auto')
    }
  )
})
