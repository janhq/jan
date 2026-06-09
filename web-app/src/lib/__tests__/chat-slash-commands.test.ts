import { describe, expect, it } from 'vitest'

import { CHAT_SLASH_COMMANDS } from '@/constants/chat-commands'
import {
  filterSlashCommands,
  getSlashCommandContext,
} from '@/lib/chat-slash-commands'

describe('getSlashCommandContext', () => {
  it('detects slash command at the start of the prompt', () => {
    expect(getSlashCommandContext('/com', 4)).toEqual({
      query: 'com',
      start: 0,
      end: 4,
    })
  })

  it('detects slash command after whitespace', () => {
    expect(getSlashCommandContext('please /rev', 11)).toEqual({
      query: 'rev',
      start: 7,
      end: 11,
    })
  })

  it('returns null when the cursor is past the active token', () => {
    expect(getSlashCommandContext('use /compact later', 16)).toBeNull()
  })
})

describe('filterSlashCommands', () => {
  it('filters commands by query prefix', () => {
    const commands = filterSlashCommands({
      query: 'co',
      codexEnabled: true,
      hasThread: true,
      isStreaming: false,
    })

    expect(commands.map((command) => command.name)).toEqual(['compact'])
  })

  it('hides codex-only commands when codex is disabled', () => {
    const commands = filterSlashCommands({
      query: '',
      codexEnabled: false,
      hasThread: true,
      isStreaming: false,
    })

    expect(commands.every((command) => !command.codexOnly)).toBe(true)
    expect(commands.map((command) => command.name)).toEqual(['clear', 'help'])
  })

  it('hides interrupt unless streaming', () => {
    const idle = filterSlashCommands({
      query: 'int',
      codexEnabled: true,
      hasThread: true,
      isStreaming: false,
    })
    const streaming = filterSlashCommands({
      query: 'int',
      codexEnabled: true,
      hasThread: true,
      isStreaming: true,
    })

    expect(idle.some((command) => command.name === 'interrupt')).toBe(false)
    expect(streaming.some((command) => command.name === 'interrupt')).toBe(true)
  })

  it('defines every command with a unique id', () => {
    const ids = CHAT_SLASH_COMMANDS.map((command) => command.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})