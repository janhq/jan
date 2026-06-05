import { describe, expect, it } from 'vitest'
import { addOpenUIToSystemPrompt } from '../openui'

describe('OpenUI prompt injection', () => {
  it('leaves the system prompt unchanged when OpenUI is disabled', async () => {
    await expect(
      addOpenUIToSystemPrompt('Base system prompt', {
        enabled: false,
        componentLibrary: 'chat',
      })
    ).resolves.toBe('Base system prompt')
  })

  it('appends chat OpenUI guidance when enabled', async () => {
    const prompt = await addOpenUIToSystemPrompt('Base system prompt', {
      enabled: true,
      componentLibrary: 'chat',
    })

    expect(prompt).toContain('Base system prompt')
    expect(prompt).toContain('Jan OpenUI integration rules:')
    expect(prompt).toContain('Card')
    expect(prompt).toContain('FollowUpBlock')
    expect(prompt.length).toBeLessThan(8_000)
  })

  it('uses OpenUI guidance as the system prompt when none exists', async () => {
    const prompt = await addOpenUIToSystemPrompt(undefined, {
      enabled: true,
      componentLibrary: 'chat',
    })

    expect(prompt).toContain('Jan OpenUI integration rules:')
    expect(prompt).not.toContain('undefined')
  })
})
