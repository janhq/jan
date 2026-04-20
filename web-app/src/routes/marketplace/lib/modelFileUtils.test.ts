import { describe, expect, it } from 'vitest'
import { extractQuantVersions, FileTreeNode } from './modelFileUtils'

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
