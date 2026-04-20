import { describe, expect, it } from 'vitest'
import { calcDownloadSize, extractQuantVersions, FileTreeNode } from './modelFileUtils'

describe('extractQuantVersions', () => {
  it('returns sorted names for tree containing multiple dir nodes', () => {
    const nodes: FileTreeNode[] = [
      {
        name: 'Q8_0',
        path: 'Q8_0',
        type: 'dir',
        children: [
          {
            name: 'model-q8_0.gguf',
            path: 'Q8_0/model-q8_0.gguf',
            type: 'file',
            size: 1000,
          },
        ],
      },
      {
        name: 'Q4_K_M',
        path: 'Q4_K_M',
        type: 'dir',
        children: [
          {
            name: 'model-q4_k_m.gguf',
            path: 'Q4_K_M/model-q4_k_m.gguf',
            type: 'file',
            size: 500,
          },
        ],
      },
      {
        name: 'Q5_K_M',
        path: 'Q5_K_M',
        type: 'dir',
        children: [
          {
            name: 'model-q5_k_m.gguf',
            path: 'Q5_K_M/model-q5_k_m.gguf',
            type: 'file',
            size: 700,
          },
        ],
      },
    ]

    const result = extractQuantVersions(nodes)
    expect(result).toEqual(['Q4_K_M', 'Q5_K_M', 'Q8_0'])
  })

  it('returns empty array for flat model with only file nodes', () => {
    const nodes: FileTreeNode[] = [
      {
        name: 'model-q4_k_m.gguf',
        path: 'model-q4_k_m.gguf',
        type: 'file',
        size: 500,
      },
      {
        name: 'model-q8_0.gguf',
        path: 'model-q8_0.gguf',
        type: 'file',
        size: 1000,
      },
    ]

    const result = extractQuantVersions(nodes)
    expect(result).toEqual([])
  })

  it('returns only dir names for mixed dir and file nodes', () => {
    const nodes: FileTreeNode[] = [
      {
        name: 'Q4_K_M',
        path: 'Q4_K_M',
        type: 'dir',
        children: [
          {
            name: 'model-q4_k_m.gguf',
            path: 'Q4_K_M/model-q4_k_m.gguf',
            type: 'file',
            size: 500,
          },
        ],
      },
      {
        name: 'README.md',
        path: 'README.md',
        type: 'file',
        size: 100,
      },
      {
        name: 'Q8_0',
        path: 'Q8_0',
        type: 'dir',
        children: [
          {
            name: 'model-q8_0.gguf',
            path: 'Q8_0/model-q8_0.gguf',
            type: 'file',
            size: 1000,
          },
        ],
      },
    ]

    const result = extractQuantVersions(nodes)
    expect(result).toEqual(['Q4_K_M', 'Q8_0'])
  })
})

describe('calcDownloadSize', () => {
  it('sums all file sizes when quantDir is null', () => {
    const nodes: FileTreeNode[] = [
      {
        name: 'Q4_K_M',
        path: 'Q4_K_M',
        type: 'dir',
        children: [
          {
            name: 'model-q4_k_m.gguf',
            path: 'Q4_K_M/model-q4_k_m.gguf',
            type: 'file',
            size: 500,
          },
        ],
      },
      {
        name: 'Q8_0',
        path: 'Q8_0',
        type: 'dir',
        children: [
          {
            name: 'model-q8_0.gguf',
            path: 'Q8_0/model-q8_0.gguf',
            type: 'file',
            size: 1000,
          },
        ],
      },
      {
        name: 'README.md',
        path: 'README.md',
        type: 'file',
        size: 100,
      },
    ]

    expect(calcDownloadSize(nodes, null)).toBe(1600)
  })

  it('sums only files under the specified quant directory', () => {
    const nodes: FileTreeNode[] = [
      {
        name: 'Q4_K_M',
        path: 'Q4_K_M',
        type: 'dir',
        children: [
          {
            name: 'model-q4_k_m.gguf',
            path: 'Q4_K_M/model-q4_k_m.gguf',
            type: 'file',
            size: 500,
          },
        ],
      },
      {
        name: 'Q8_0',
        path: 'Q8_0',
        type: 'dir',
        children: [
          {
            name: 'model-q8_0.gguf',
            path: 'Q8_0/model-q8_0.gguf',
            type: 'file',
            size: 1000,
          },
        ],
      },
      {
        name: 'README.md',
        path: 'README.md',
        type: 'file',
        size: 100,
      },
    ]

    expect(calcDownloadSize(nodes, 'Q4_K_M')).toBe(500)
    expect(calcDownloadSize(nodes, 'Q8_0')).toBe(1000)
  })

  it('works with flat model (no directories)', () => {
    const nodes: FileTreeNode[] = [
      {
        name: 'model-q4_k_m.gguf',
        path: 'model-q4_k_m.gguf',
        type: 'file',
        size: 500,
      },
      {
        name: 'model-q8_0.gguf',
        path: 'model-q8_0.gguf',
        type: 'file',
        size: 1000,
      },
    ]

    expect(calcDownloadSize(nodes, null)).toBe(1500)
    expect(calcDownloadSize(nodes, 'Q4_K_M')).toBe(0)
  })

  it('does not count directory sizes', () => {
    const nodes: FileTreeNode[] = [
      {
        name: 'Q4_K_M',
        path: 'Q4_K_M',
        type: 'dir',
        size: 999,
        children: [
          {
            name: 'model-q4_k_m.gguf',
            path: 'Q4_K_M/model-q4_k_m.gguf',
            type: 'file',
            size: 500,
          },
        ],
      },
    ]

    expect(calcDownloadSize(nodes, null)).toBe(500)
    expect(calcDownloadSize(nodes, 'Q4_K_M')).toBe(500)
  })

  it('treats undefined size as 0', () => {
    const nodes: FileTreeNode[] = [
      {
        name: 'model.gguf',
        path: 'model.gguf',
        type: 'file',
      },
      {
        name: 'README.md',
        path: 'README.md',
        type: 'file',
        size: 100,
      },
    ]

    expect(calcDownloadSize(nodes, null)).toBe(100)
  })
})
