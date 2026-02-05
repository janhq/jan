import { describe, it, expect } from 'vitest'
import { HuggingFaceRepo, CatalogModel } from '@/services/models'

// Helper function to test the conversion logic (extracted from the component)
const convertHfRepoToCatalogModel = (repo: HuggingFaceRepo): CatalogModel => {
  // Extract GGUF files from the repository siblings
  const ggufFiles =
    repo.siblings?.filter((file) =>
      file.rfilename.toLowerCase().endsWith('.gguf')
    ) || []

  // Convert GGUF files to quants format
  const quants = ggufFiles.map((file) => {
    // Format file size
    const formatFileSize = (size?: number) => {
      if (!size) return 'Unknown size'
      if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`
      return `${(size / 1024 ** 3).toFixed(1)} GB`
    }

    // Generate model_id from filename (remove .gguf extension, case-insensitive)
    const modelId = file.rfilename.replace(/\.gguf$/i, '')

    return {
      model_id: modelId,
      path: `https://huggingface.co/${repo.modelId}/resolve/main/${file.rfilename}`,
      file_size: formatFileSize(file.size),
    }
  })

  return {
    model_name: repo.modelId,
    description: `**Metadata:** ${repo.pipeline_tag}\n\n **Tags**: ${repo.tags?.join(', ')}`,
    developer: repo.author,
    downloads: repo.downloads || 0,
    num_quants: quants.length,
    quants: quants,
    created_at: repo.created_at,
    readme: `https://huggingface.co/${repo.modelId}/resolve/main/README.md`,
  }
}

describe('HuggingFace Repository Conversion', () => {
  const mockHuggingFaceRepo: HuggingFaceRepo = {
    id: 'microsoft/DialoGPT-medium',
    modelId: 'microsoft/DialoGPT-medium',
    sha: 'abc123',
    downloads: 5000,
    likes: 100,
    tags: ['conversational', 'pytorch', 'text-generation'],
    pipeline_tag: 'text-generation',
    created_at: '2023-01-01T00:00:00Z',
    last_modified: '2023-12-01T00:00:00Z',
    private: false,
    disabled: false,
    gated: false,
    author: 'microsoft',
    siblings: [
      {
        rfilename: 'model-Q4_K_M.gguf',
        size: 2147483648, // 2GB
        blobId: 'blob123',
      },
      {
        rfilename: 'model-Q8_0.gguf',
        size: 4294967296, // 4GB
        blobId: 'blob456',
      },
      {
        rfilename: 'model-small.gguf',
        size: 536870912, // 512MB
        blobId: 'blob789',
      },
      {
        rfilename: 'README.md',
        size: 1024,
        blobId: 'blob101',
      },
    ],
    readme: '# DialoGPT Model\nThis is a conversational AI model.',
  }

  describe('convertHfRepoToCatalogModel', () => {
    it('should convert HuggingFace repository to CatalogModel correctly', () => {
      const result = convertHfRepoToCatalogModel(mockHuggingFaceRepo)

      expect(result).toEqual({
        model_name: 'microsoft/DialoGPT-medium',
        description: '**Metadata:** text-generation\n\n **Tags**: conversational, pytorch, text-generation',
        developer: 'microsoft',
        downloads: 5000,
        num_quants: 3,
        quants: [
          {
            model_id: 'model-Q4_K_M',
            path: 'https://huggingface.co/microsoft/DialoGPT-medium/resolve/main/model-Q4_K_M.gguf',
            file_size: '2.0 GB',
          },
          {
            model_id: 'model-Q8_0',
            path: 'https://huggingface.co/microsoft/DialoGPT-medium/resolve/main/model-Q8_0.gguf',
            file_size: '4.0 GB',
          },
          {
            model_id: 'model-small',
            path: 'https://huggingface.co/microsoft/DialoGPT-medium/resolve/main/model-small.gguf',
            file_size: '512.0 MB',
          },
        ],
        created_at: '2023-01-01T00:00:00Z',
        readme: 'https://huggingface.co/microsoft/DialoGPT-medium/resolve/main/README.md',
      })
    })

    it('should filter only GGUF files from siblings', () => {
      const result = convertHfRepoToCatalogModel(mockHuggingFaceRepo)

      // Should have 3 GGUF files, not 4 total files
      expect(result.num_quants).toBe(3)
      expect(result.quants).toHaveLength(3)

      // All quants should be from GGUF files
      result.quants.forEach((quant) => {
        expect(quant.path).toContain('.gguf')
      })
    })

    it('should format file sizes correctly', () => {
      const result = convertHfRepoToCatalogModel(mockHuggingFaceRepo)

      expect(result.quants[0].file_size).toBe('2.0 GB') // 2GB
      expect(result.quants[1].file_size).toBe('4.0 GB') // 4GB
      expect(result.quants[2].file_size).toBe('512.0 MB') // 512MB
    })

    it('should generate correct download paths', () => {
      const result = convertHfRepoToCatalogModel(mockHuggingFaceRepo)

      expect(result.quants[0].path).toBe(
        'https://huggingface.co/microsoft/DialoGPT-medium/resolve/main/model-Q4_K_M.gguf'
      )
      expect(result.quants[1].path).toBe(
        'https://huggingface.co/microsoft/DialoGPT-medium/resolve/main/model-Q8_0.gguf'
      )
    })

    it('should generate correct model IDs by removing .gguf extension', () => {
      const result = convertHfRepoToCatalogModel(mockHuggingFaceRepo)

      expect(result.quants[0].model_id).toBe('model-Q4_K_M')
      expect(result.quants[1].model_id).toBe('model-Q8_0')
      expect(result.quants[2].model_id).toBe('model-small')
    })

    it('should handle repository with no siblings', () => {
      const repoWithoutSiblings = {
        ...mockHuggingFaceRepo,
        siblings: undefined,
      }

      const result = convertHfRepoToCatalogModel(repoWithoutSiblings)

      expect(result.num_quants).toBe(0)
      expect(result.quants).toEqual([])
    })

    it('should handle repository with empty siblings array', () => {
      const repoWithEmptySiblings = {
        ...mockHuggingFaceRepo,
        siblings: [],
      }

      const result = convertHfRepoToCatalogModel(repoWithEmptySiblings)

      expect(result.num_quants).toBe(0)
      expect(result.quants).toEqual([])
    })

    it('should handle repository with no GGUF files', () => {
      const repoWithoutGGUF = {
        ...mockHuggingFaceRepo,
        siblings: [
          {
            rfilename: 'README.md',
            size: 1024,
            blobId: 'blob101',
          },
          {
            rfilename: 'config.json',
            size: 512,
            blobId: 'blob102',
          },
        ],
      }

      const result = convertHfRepoToCatalogModel(repoWithoutGGUF)

      expect(result.num_quants).toBe(0)
      expect(result.quants).toEqual([])
    })

    it('should handle files with unknown sizes', () => {
      const repoWithUnknownSizes = {
        ...mockHuggingFaceRepo,
        siblings: [
          {
            rfilename: 'model-unknown.gguf',
            size: undefined,
            blobId: 'blob123',
          },
        ],
      }

      const result = convertHfRepoToCatalogModel(repoWithUnknownSizes)

      expect(result.quants[0].file_size).toBe('Unknown size')
    })

    it('should handle repository with zero downloads', () => {
      const repoWithZeroDownloads = {
        ...mockHuggingFaceRepo,
        downloads: 0,
      }

      const result = convertHfRepoToCatalogModel(repoWithZeroDownloads)

      expect(result.downloads).toBe(0)
    })

    it('should handle repository with no tags', () => {
      const repoWithoutTags = {
        ...mockHuggingFaceRepo,
        tags: [],
      }

      const result = convertHfRepoToCatalogModel(repoWithoutTags)

      expect(result.description).toContain('**Tags**: ')
    })

    it('should handle repository with no pipeline_tag', () => {
      const repoWithoutPipelineTag = {
        ...mockHuggingFaceRepo,
        pipeline_tag: undefined,
      }

      const result = convertHfRepoToCatalogModel(repoWithoutPipelineTag)

      expect(result.description).toContain('**Metadata:** undefined')
    })

    it('should generate README URL correctly', () => {
      const result = convertHfRepoToCatalogModel(mockHuggingFaceRepo)

      expect(result.readme).toBe(
        'https://huggingface.co/microsoft/DialoGPT-medium/resolve/main/README.md'
      )
    })

    it('should handle case-insensitive GGUF file extensions', () => {
      const repoWithMixedCase = {
        ...mockHuggingFaceRepo,
        siblings: [
          {
            rfilename: 'model-uppercase.GGUF',
            size: 1024,
            blobId: 'blob1',
          },
          {
            rfilename: 'model-mixedcase.Gguf',
            size: 2048,
            blobId: 'blob2',
          },
          {
            rfilename: 'model-lowercase.gguf',
            size: 4096,
            blobId: 'blob3',
          },
        ],
      }

      const result = convertHfRepoToCatalogModel(repoWithMixedCase)

      expect(result.num_quants).toBe(3)
      expect(result.quants[0].model_id).toBe('model-uppercase')
      expect(result.quants[1].model_id).toBe('model-mixedcase')
      expect(result.quants[2].model_id).toBe('model-lowercase')
    })

    it('should handle very large file sizes (> 1TB)', () => {
      const repoWithLargeFiles = {
        ...mockHuggingFaceRepo,
        siblings: [
          {
            rfilename: 'huge-model.gguf',
            size: 1099511627776, // 1TB
            blobId: 'blob1',
          },
        ],
      }

      const result = convertHfRepoToCatalogModel(repoWithLargeFiles)

      expect(result.quants[0].file_size).toBe('1024.0 GB')
    })
  })
})
