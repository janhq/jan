import { renderJinjaTemplate } from './index'
import { Template } from '@huggingface/jinja'

jest.mock('@huggingface/jinja', () => ({
  Template: jest.fn((template: string) => ({
    render: jest.fn(() => `${template}_rendered`),
  })),
}))

describe('renderJinjaTemplate', () => {
  beforeEach(() => {
    jest.clearAllMocks() // Clear mocks between tests
  })

  it('should render the template with correct parameters', () => {
    const metadata = {
      'tokenizer.chat_template': 'Hello, {{ messages }}!',
      'tokenizer.ggml.eos_token_id': 0,
      'tokenizer.ggml.bos_token_id': 1,
      'tokenizer.ggml.tokens': ['EOS', 'BOS'],
    }

    const renderedTemplate = renderJinjaTemplate(metadata)

    expect(Template).toHaveBeenCalledWith('Hello, {{ messages }}!')

    expect(renderedTemplate).toBe('Hello, {{ messages }}!_rendered')
  })

  it('should handle missing token IDs gracefully', () => {
    const metadata = {
      'tokenizer.chat_template': 'Hello, {{ messages }}!',
      'tokenizer.ggml.eos_token_id': 0,
      'tokenizer.ggml.tokens': ['EOS'],
    }

    const renderedTemplate = renderJinjaTemplate(metadata)

    expect(Template).toHaveBeenCalledWith('Hello, {{ messages }}!')

    expect(renderedTemplate).toBe('')
  })

  it('should handle empty template gracefully', () => {
    const metadata = {}

    const renderedTemplate = renderJinjaTemplate(metadata)

    expect(Template).toHaveBeenCalledWith(undefined)

    expect(renderedTemplate).toBe("")
  })
})
