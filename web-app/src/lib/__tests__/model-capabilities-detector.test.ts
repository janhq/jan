import { describe, it, expect } from 'vitest'
import { detectModelCapabilities, hasDetectedCapabilities } from '../model-capabilities-detector'

describe('detectModelCapabilities', () => {
  describe('reasoning', () => {
    it.each([
      'deepseek-r1',
      'deepseek-r1:7b',
      'deepseek/deepseek-r1:free',
      'deepseek-r2',
      'deepseek-reasoner',
      'qwq-32b',
      'qwq',
      'qvq-72b',
      'phi-4-reasoning',
      'exaone-deep-7.8b',
      'lfm-thinking-20b',
      'claude-3-5-sonnet-thinking-20251001',
      'model:thinking',
    ])('detects reasoning for %s', (modelId) => {
      expect(detectModelCapabilities(modelId).reasoning).toBe(true)
    })

    it.each([
      'o1',
      'o1-mini',
      'o1-preview',
      'o3',
      'o3-mini',
    ])('detects reasoning for OpenAI o-series: %s', (modelId) => {
      expect(detectModelCapabilities(modelId).reasoning).toBe(true)
    })

    it.each([
      'llama3.2',
      'mistral-7b',
      'gpt-4o',
      'gemma-2-9b',
      'phi-3-mini',
      'tool-use-model',
    ])('does NOT detect reasoning for %s', (modelId) => {
      expect(detectModelCapabilities(modelId).reasoning).toBe(false)
    })
  })

  describe('web_search', () => {
    it.each([
      'perplexity/sonar',
      'sonar-pro',
      'llama-3.1-sonar-large-128k-online',
      'model-online',
      'model:online',
      'web-search-model',
    ])('detects web_search for %s', (modelId) => {
      expect(detectModelCapabilities(modelId).web_search).toBe(true)
    })

    it.each([
      'llama3.2',
      'gpt-4o',
      'deepseek-r1',
      'mistral-7b',
    ])('does NOT detect web_search for %s', (modelId) => {
      expect(detectModelCapabilities(modelId).web_search).toBe(false)
    })
  })

  describe('embeddings', () => {
    it.each([
      'nomic-embed-text',
      'mxbai-embed-large',
      'text-embedding-3-small',
      'bge-large-en',
      'intfloat-e5-large',
      'gte-qwen2-7b',
    ])('detects embeddings for %s', (modelId) => {
      expect(detectModelCapabilities(modelId).embeddings).toBe(true)
    })

    it.each([
      'llama3.2',
      'gpt-4o',
      'deepseek-r1',
      'phi-3-mini',
    ])('does NOT detect embeddings for %s', (modelId) => {
      expect(detectModelCapabilities(modelId).embeddings).toBe(false)
    })
  })

  it('is case-insensitive', () => {
    expect(detectModelCapabilities('DeepSeek-R1').reasoning).toBe(true)
    expect(detectModelCapabilities('NOMIC-EMBED-TEXT').embeddings).toBe(true)
    expect(detectModelCapabilities('Sonar-Pro').web_search).toBe(true)
  })

  it('can detect multiple capabilities on one model', () => {
    const result = detectModelCapabilities('sonar-reasoning')
    expect(result.reasoning).toBe(true)
    expect(result.web_search).toBe(true)
  })
})

describe('hasDetectedCapabilities', () => {
  it('returns true when any capability is detected', () => {
    expect(hasDetectedCapabilities({ reasoning: true, web_search: false, embeddings: false })).toBe(true)
    expect(hasDetectedCapabilities({ reasoning: false, web_search: true, embeddings: false })).toBe(true)
    expect(hasDetectedCapabilities({ reasoning: false, web_search: false, embeddings: true })).toBe(true)
  })

  it('returns false when no capability is detected', () => {
    expect(hasDetectedCapabilities({ reasoning: false, web_search: false, embeddings: false })).toBe(false)
  })
})
