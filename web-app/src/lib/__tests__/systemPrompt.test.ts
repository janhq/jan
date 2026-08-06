import { describe, it, expect } from 'vitest'
import {
  buildSystemPrompt,
  buildEnvironmentBlock,
  getSystemEnv,
} from '../systemPrompt'
import type { HardwareData } from '@/hooks/useHardware'

describe('buildSystemPrompt', () => {
  it('returns undefined when there is no instructions or env info', () => {
    expect(buildSystemPrompt(undefined, {})).toBeUndefined()
  })

  it('returns just the instructions when no env info is usable', () => {
    const out = buildSystemPrompt('  Be helpful.  ', {})
    expect(out).toBe('Be helpful.')
  })

  it('returns undefined for whitespace-only instructions', () => {
    expect(buildSystemPrompt('   ')).toBeUndefined()
  })

  it('combines instructions with an environment block', () => {
    const out = buildSystemPrompt('Be concise.', {
      osName: 'macOS 14.5',
      arch: 'arm64',
      janVersion: '0.5.0',
    })
    expect(out).toContain('Be concise.')
    expect(out).toContain('# Current environment')
    expect(out).toContain('OS: macOS 14.5')
    expect(out).toContain('Jan version: 0.5.0')
    // instructions come first
    expect(out!.indexOf('Be concise.')).toBeLessThan(out!.indexOf('# Current environment'))
  })
})

describe('buildEnvironmentBlock', () => {
  it('returns an empty string when nothing is usable', () => {
    expect(buildEnvironmentBlock({})).toBe('')
  })

  it('lists only provided fields', () => {
    const out = buildEnvironmentBlock({ osName: 'Windows 11', cpuName: 'AMD' })
    expect(out).toContain('OS: Windows 11')
    expect(out).toContain('CPU: AMD')
    expect(out).not.toContain('Architecture:')
    expect(out).not.toContain('Memory:')
  })

  it('formats memory in gigabytes', () => {
    const out = buildEnvironmentBlock({ totalMemory: 16 * 1024 ** 3 })
    expect(out).toContain('Memory: 16 GB')
  })

  it('falls back to the platform label when no os name is present', () => {
    const out = buildEnvironmentBlock({ platform: 'Linux' })
    expect(out).toContain('OS: Linux')
  })
})

describe('getSystemEnv', () => {
  const baseHardware: HardwareData = {
    cpu: { arch: 'arm64', core_count: 8, extensions: [], name: '', usage: 0 },
    gpus: [],
    os_type: '',
    os_name: '',
    total_memory: 0,
  }

  it('maps os_type to a display platform when os_name is empty', () => {
    const env = getSystemEnv({ ...baseHardware, os_type: 'macos' })
    expect(env.platform).toBe('macOS')
    expect(env.osName).toBeUndefined()
  })

  it('prefers os_name over the platform label', () => {
    const env = getSystemEnv({ ...baseHardware, os_type: 'linux', os_name: 'Ubuntu 22.04' })
    expect(env.osName).toBe('Ubuntu 22.04')
    expect(env.platform).toBeUndefined()
  })

  it('carries cpu, memory and version through', () => {
    const env = getSystemEnv({
      ...baseHardware,
      os_type: 'windows',
      cpu: { arch: 'x86_64', core_count: 8, extensions: [], name: 'Intel i7', usage: 0 },
      total_memory: 8 * 1024 ** 3,
    })
    expect(env.arch).toBe('x86_64')
    expect(env.cpuName).toBe('Intel i7')
    expect(env.totalMemory).toBe(8 * 1024 ** 3)
    expect(env.janVersion).toBeDefined()
  })
})
