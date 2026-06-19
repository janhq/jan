import { describe, it, expect, beforeEach } from 'vitest'
import { pruneLocalStorageByFlags } from '../reset-localstorage'

describe('pruneLocalStorageByFlags', () => {
  beforeEach(() => localStorage.clear())

  const seed = () => {
    localStorage.setItem('model-provider', '{"providers":[]}')
    localStorage.setItem('last-used-model', 'ghost')
    localStorage.setItem('threads', '[]')
    localStorage.setItem('setup-completed', 'true')
  }

  it('clears model + thread + setup keys on a full wipe', () => {
    seed()
    pruneLocalStorageByFlags({ keepAppData: false, keepModelsAndConfigs: false })

    expect(localStorage.getItem('model-provider')).toBeNull()
    expect(localStorage.getItem('last-used-model')).toBeNull()
    expect(localStorage.getItem('threads')).toBeNull()
    expect(localStorage.getItem('setup-completed')).toBeNull()
  })

  it('keeps model keys and setup flag when models are preserved', () => {
    seed()
    pruneLocalStorageByFlags({ keepAppData: false, keepModelsAndConfigs: true })

    expect(localStorage.getItem('model-provider')).toBe('{"providers":[]}')
    expect(localStorage.getItem('setup-completed')).toBe('true')
    // app data still wiped
    expect(localStorage.getItem('threads')).toBeNull()
  })

  it('keeps thread keys when app data is preserved', () => {
    seed()
    pruneLocalStorageByFlags({ keepAppData: true, keepModelsAndConfigs: false })

    expect(localStorage.getItem('threads')).toBe('[]')
    expect(localStorage.getItem('model-provider')).toBeNull()
    // setup flag only cleared on a full wipe
    expect(localStorage.getItem('setup-completed')).toBe('true')
  })
})
