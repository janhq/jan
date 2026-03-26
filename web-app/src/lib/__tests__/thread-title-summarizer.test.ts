import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanTitle, generateThreadTitle } from '../thread-title-summarizer'

// Mock AI SDK generateText
const mockGenerateText = vi.fn()
vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}))

// Mock ModelFactory
const mockCreateModel = vi.fn()
vi.mock('../model-factory', () => ({
  ModelFactory: {
    createModel: (...args: unknown[]) => mockCreateModel(...args),
  },
}))

// Mock useModelProvider
const mockGetProviderByName = vi.fn()
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: {
    getState: () => ({
      selectedModel: { id: 'test-model' },
      selectedProvider: 'test-provider',
      getProviderByName: mockGetProviderByName,
    }),
  },
}))

describe('cleanTitle', () => {
  it('returns a clean title from normal text', () => {
    expect(cleanTitle('Hello World')).toBe('Hello World')
  })

  it('strips reasoning tags', () => {
    expect(
      cleanTitle('<think>let me think about this...</think>JavaScript Basics')
    ).toBe('JavaScript Basics')
  })

  it('handles multiline reasoning blocks', () => {
    const input = '<think>\nstep 1\nstep 2\n</think> Final Answer'
    expect(cleanTitle(input)).toBe('Final Answer')
  })

  it('removes surrounding quotes', () => {
    expect(cleanTitle('"My Great Title"')).toBe('My Great Title')
    expect(cleanTitle("'Single Quoted'")).toBe('Single Quoted')
  })

  it('collapses whitespace and newlines', () => {
    expect(cleanTitle('Too   many   spaces')).toBe('Too many spaces')
    expect(cleanTitle('Title with\nnewline')).toBe('Title with newline')
    expect(cleanTitle('Tabs\tand\tnewlines\n')).toBe('Tabs and newlines')
  })

  it('enforces word limit of 10', () => {
    const longTitle =
      'One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve'
    const result = cleanTitle(longTitle)
    expect(result).toBe('One Two Three Four Five Six Seven Eight Nine Ten')
  })

  it('keeps unicode characters', () => {
    expect(cleanTitle('日本語のタイトル')).toBe('日本語のタイトル')
    expect(cleanTitle('Título en español')).toBe('Título en español')
    expect(cleanTitle('Résumé du projet')).toBe('Résumé du projet')
  })

  it('removes special characters but keeps letters and numbers', () => {
    expect(cleanTitle('Title! With@ Special# Chars$')).toBe(
      'Title With Special Chars'
    )
    expect(cleanTitle('Version 2.0 Release')).toBe('Version 20 Release')
  })

  it('returns null for empty or very short text', () => {
    expect(cleanTitle('')).toBeNull()
    expect(cleanTitle('   ')).toBeNull()
    expect(cleanTitle('a')).toBeNull()
  })

  it('returns null when only special characters remain', () => {
    expect(cleanTitle('!@#$%^&*()')).toBeNull()
  })

  it('removes leftover XML tags', () => {
    expect(cleanTitle('<b>Bold Title</b>')).toBe('Bold Title')
    expect(cleanTitle('Before <em>and</em> after')).toBe('Before and after')
  })

  it('handles text that is only a reasoning block', () => {
    expect(cleanTitle('<think>only reasoning</think>')).toBeNull()
  })

  it('handles nested or malformed tags gracefully', () => {
    expect(cleanTitle('Title <br/> with breaks')).toBe('Title with breaks')
  })
})

describe('generateThreadTitle', () => {
  const mockModel = { id: 'test-model' }
  const mockProvider = { provider: 'test-provider', models: [] }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProviderByName.mockReturnValue(mockProvider)
    mockCreateModel.mockResolvedValue(mockModel)
  })

  it('returns a cleaned title on success', async () => {
    mockGenerateText.mockResolvedValue({ text: 'Python List Sorting' })

    const controller = new AbortController()
    const result = await generateThreadTitle(
      'Can you help me write a function to sort a list in Python?',
      controller.signal
    )

    expect(result).toBe('Python List Sorting')
    expect(mockCreateModel).toHaveBeenCalledWith('test-model', mockProvider, {})
    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: mockModel,
        abortSignal: controller.signal,
      })
    )
  })

  it('returns null when aborted', async () => {
    const abortError = new Error('Aborted')
    abortError.name = 'AbortError'
    mockGenerateText.mockRejectedValue(abortError)

    const controller = new AbortController()
    const result = await generateThreadTitle('test message', controller.signal)

    expect(result).toBeNull()
  })

  it('returns null when provider lookup fails', async () => {
    mockGetProviderByName.mockReturnValueOnce(undefined)

    const controller = new AbortController()
    const result = await generateThreadTitle('test message', controller.signal)

    expect(result).toBeNull()
    expect(mockCreateModel).not.toHaveBeenCalled()
  })

  it('returns null when model generation fails', async () => {
    mockGenerateText.mockRejectedValue(new Error('Network error'))

    const controller = new AbortController()
    const result = await generateThreadTitle('test message', controller.signal)

    expect(result).toBeNull()
  })

  it('returns null when generated text cleans to nothing', async () => {
    mockGenerateText.mockResolvedValue({ text: '!!!' })

    const controller = new AbortController()
    const result = await generateThreadTitle('test message', controller.signal)

    expect(result).toBeNull()
  })

  it('truncates long messages before sending to model', async () => {
    mockGenerateText.mockResolvedValue({ text: 'Summary Title' })
    const longMessage = 'x'.repeat(1000)

    const controller = new AbortController()
    await generateThreadTitle(longMessage, controller.signal)

    // Verify the prompt was truncated (500 chars + "...")
    const callArgs = mockGenerateText.mock.calls[0][0]
    const prompt = callArgs.messages[0].content
    expect(prompt).toContain('...')
    expect(prompt.length).toBeLessThan(1000)
  })

  it('passes the abort signal to generateText', async () => {
    mockGenerateText.mockResolvedValue({ text: 'Title' })

    const controller = new AbortController()
    await generateThreadTitle('test message', controller.signal)

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        abortSignal: controller.signal,
      })
    )
  })
})
