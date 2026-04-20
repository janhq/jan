import { describe, it, expect } from 'vitest'
import { quantPriority, selectBestGgufFile } from '../lib/modelFileUtils'
import fixtures from '../__fixtures__/modelscope-api-responses.json'

// ─────────────────────────────────────────────────────────────
// quantPriority
// ─────────────────────────────────────────────────────────────
describe('quantPriority', () => {
  it('gives q4_k_m the highest score', () => {
    expect(quantPriority('model-q4_k_m.gguf')).toBe(3)
    expect(quantPriority('MODEL-Q4_K_M.gguf')).toBe(3)
  })

  it('gives q5_k_m the second highest score', () => {
    expect(quantPriority('model-q5_k_m.gguf')).toBe(2)
  })

  it('gives q8_0 the third highest score', () => {
    expect(quantPriority('model-q8_0.gguf')).toBe(1)
  })

  it('gives everything else zero', () => {
    expect(quantPriority('model-fp16.gguf')).toBe(0)
    expect(quantPriority('model-q2_k.gguf')).toBe(0)
    expect(quantPriority('model-q3_k_m.gguf')).toBe(0)
    expect(quantPriority('model-q4_0.gguf')).toBe(0)
    expect(quantPriority('model-q6_k.gguf')).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────
// selectBestGgufFile - real API fixtures
// ─────────────────────────────────────────────────────────────
describe('selectBestGgufFile with real ModelScope fixtures', () => {
  it('selects q4_k_m from qwen/Qwen2.5-0.5B-Instruct-GGUF (13 files)', () => {
    const resp = fixtures['qwen/Qwen2.5-0.5B-Instruct-GGUF']
    const result = selectBestGgufFile(resp.Data)

    expect(result).not.toBeNull()
    expect(result!.Name).toBe('qwen2.5-0.5b-instruct-q4_k_m.gguf')
    expect(result!.Path).toBe('qwen2.5-0.5b-instruct-q4_k_m.gguf')
    expect(result!.Size).toBe(491400032)
    expect(result!.Sha256).toBe(
      '74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db'
    )
    expect(result!.IsLFS).toBe(true)
  })

  it('selects from unsloth/DeepSeek-R1-Distill-Qwen-1.5B-GGUF (22 files)', () => {
    const resp = fixtures['unsloth/DeepSeek-R1-Distill-Qwen-1.5B-GGUF']
    const result = selectBestGgufFile(resp.Data)

    expect(result).not.toBeNull()
    // This model has no q4_k_m, so the first GGUF after sorting by priority wins
    // All have priority 0, so the sort is stable-ish (first in array)
    expect(result!.Name.toLowerCase().endsWith('.gguf')).toBe(true)
    expect(result!.Name.toLowerCase().includes('mmproj')).toBe(false)
  })

  it('filters out non-.gguf files', () => {
    const resp = fixtures['qwen/Qwen2.5-0.5B-Instruct-GGUF']
    const result = selectBestGgufFile(resp.Data)

    const allFiles = resp.Data.Files
    const nonGgufs = allFiles.filter(
      (f: any) => !f.Name.toLowerCase().endsWith('.gguf')
    )
    expect(nonGgufs.length).toBeGreaterThan(0) // .gitattributes, config.json etc.
    expect(result!.Name.toLowerCase().endsWith('.gguf')).toBe(true)
  })

  it('returns null for empty Files array', () => {
    const result = selectBestGgufFile({ Files: [] })
    expect(result).toBeNull()
  })

  it('returns null for null input', () => {
    expect(selectBestGgufFile(null)).toBeNull()
    expect(selectBestGgufFile(undefined)).toBeNull()
  })

  it('returns null when no GGUF files exist', () => {
    const result = selectBestGgufFile({
      Files: [
        { Name: 'README.md', Size: 100 },
        { Name: 'config.json', Size: 200 },
      ],
    })
    expect(result).toBeNull()
  })

  it('returns null when only mmproj GGUFs exist', () => {
    const result = selectBestGgufFile({
      Files: [
        { Name: 'model-mmproj-f16.gguf', Size: 100 },
        { Name: 'model-mmproj-q4_0.gguf', Size: 200 },
      ],
    })
    expect(result).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────
// selectBestGgufFile - snake_case compatibility
// ─────────────────────────────────────────────────────────────
describe('selectBestGgufFile snake_case compatibility', () => {
  it('reads files/name from snake_case response', () => {
    const result = selectBestGgufFile({
      files: [
        { name: 'model-fp16.gguf', size: 100 },
        { name: 'model-q4_k_m.gguf', size: 200 },
      ],
    })
    expect(result).not.toBeNull()
    expect(result!.Name).toBe('model-q4_k_m.gguf')
    expect(result!.Size).toBe(200)
  })

  it('reads sha256 and is_lfs from snake_case response', () => {
    const result = selectBestGgufFile({
      files: [
        {
          name: 'test.gguf',
          path: 'test.gguf',
          size: 123,
          sha256: 'abc123',
          is_lfs: true,
        },
      ],
    })
    expect(result).not.toBeNull()
    expect(result!.Sha256).toBe('abc123')
    expect(result!.IsLFS).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────
// selectBestGgufFile - priority ordering
// ─────────────────────────────────────────────────────────────
describe('selectBestGgufFile priority ordering', () => {
  it('prefers q4_k_m over q5_k_m over q8_0 over others', () => {
    const result = selectBestGgufFile({
      Files: [
        { Name: 'model-fp16.gguf' },
        { Name: 'model-q8_0.gguf' },
        { Name: 'model-q5_k_m.gguf' },
        { Name: 'model-q4_k_m.gguf' },
        { Name: 'model-q2_k.gguf' },
      ],
    })
    expect(result!.Name).toBe('model-q4_k_m.gguf')
  })

  it('prefers q5_k_m when q4_k_m is absent', () => {
    const result = selectBestGgufFile({
      Files: [
        { Name: 'model-fp16.gguf' },
        { Name: 'model-q8_0.gguf' },
        { Name: 'model-q5_k_m.gguf' },
      ],
    })
    expect(result!.Name).toBe('model-q5_k_m.gguf')
  })

  it('prefers q8_0 when q4_k_m and q5_k_m are absent', () => {
    const result = selectBestGgufFile({
      Files: [
        { Name: 'model-fp16.gguf' },
        { Name: 'model-q8_0.gguf' },
        { Name: 'model-q2_k.gguf' },
      ],
    })
    expect(result!.Name).toBe('model-q8_0.gguf')
  })
})
