// web/utils/modelParam.test.ts
import { validationRules } from './modelParam'

describe('validationRules', () => {
  it('should validate temperature correctly', () => {
    expect(validationRules.temperature(0.5)).toBe(true)
    expect(validationRules.temperature(1)).toBe(true)
    expect(validationRules.temperature(0)).toBe(true)
    expect(validationRules.temperature(-0.1)).toBe(false)
    expect(validationRules.temperature(1.1)).toBe(false)
    expect(validationRules.temperature('0.5')).toBe(false)
  })

  it('should validate token_limit correctly', () => {
    expect(validationRules.token_limit(100)).toBe(true)
    expect(validationRules.token_limit(1)).toBe(true)
    expect(validationRules.token_limit(0)).toBe(true)
    expect(validationRules.token_limit(-1)).toBe(false)
    expect(validationRules.token_limit('100')).toBe(false)
  })

  it('should validate top_k correctly', () => {
    expect(validationRules.top_k(0.5)).toBe(true)
    expect(validationRules.top_k(1)).toBe(true)
    expect(validationRules.top_k(0)).toBe(true)
    expect(validationRules.top_k(-0.1)).toBe(false)
    expect(validationRules.top_k(1.1)).toBe(false)
    expect(validationRules.top_k('0.5')).toBe(false)
  })

  it('should validate top_p correctly', () => {
    expect(validationRules.top_p(0.5)).toBe(true)
    expect(validationRules.top_p(1)).toBe(true)
    expect(validationRules.top_p(0)).toBe(true)
    expect(validationRules.top_p(-0.1)).toBe(false)
    expect(validationRules.top_p(1.1)).toBe(false)
    expect(validationRules.top_p('0.5')).toBe(false)
  })

  it('should validate stream correctly', () => {
    expect(validationRules.stream(true)).toBe(true)
    expect(validationRules.stream(false)).toBe(true)
    expect(validationRules.stream('true')).toBe(false)
    expect(validationRules.stream(1)).toBe(false)
  })

  it('should validate max_tokens correctly', () => {
    expect(validationRules.max_tokens(100)).toBe(true)
    expect(validationRules.max_tokens(1)).toBe(true)
    expect(validationRules.max_tokens(0)).toBe(true)
    expect(validationRules.max_tokens(-1)).toBe(false)
    expect(validationRules.max_tokens('100')).toBe(false)
  })

  it('should validate stop correctly', () => {
    expect(validationRules.stop(['word1', 'word2'])).toBe(true)
    expect(validationRules.stop([])).toBe(true)
    expect(validationRules.stop(['word1', 2])).toBe(false)
    expect(validationRules.stop('word1')).toBe(false)
  })

  it('should validate frequency_penalty correctly', () => {
    expect(validationRules.frequency_penalty(0.5)).toBe(true)
    expect(validationRules.frequency_penalty(1)).toBe(true)
    expect(validationRules.frequency_penalty(0)).toBe(true)
    expect(validationRules.frequency_penalty(-0.1)).toBe(false)
    expect(validationRules.frequency_penalty(1.1)).toBe(false)
    expect(validationRules.frequency_penalty('0.5')).toBe(false)
  })

  it('should validate presence_penalty correctly', () => {
    expect(validationRules.presence_penalty(0.5)).toBe(true)
    expect(validationRules.presence_penalty(1)).toBe(true)
    expect(validationRules.presence_penalty(0)).toBe(true)
    expect(validationRules.presence_penalty(-0.1)).toBe(false)
    expect(validationRules.presence_penalty(1.1)).toBe(false)
    expect(validationRules.presence_penalty('0.5')).toBe(false)
  })

  it('should validate ctx_len correctly', () => {
    expect(validationRules.ctx_len(1024)).toBe(true)
    expect(validationRules.ctx_len(1)).toBe(true)
    expect(validationRules.ctx_len(0)).toBe(true)
    expect(validationRules.ctx_len(-1)).toBe(false)
    expect(validationRules.ctx_len('1024')).toBe(false)
  })

  it('should validate ngl correctly', () => {
    expect(validationRules.ngl(12)).toBe(true)
    expect(validationRules.ngl(1)).toBe(true)
    expect(validationRules.ngl(0)).toBe(true)
    expect(validationRules.ngl(-1)).toBe(false)
    expect(validationRules.ngl('12')).toBe(false)
  })

  it('should validate embedding correctly', () => {
    expect(validationRules.embedding(true)).toBe(true)
    expect(validationRules.embedding(false)).toBe(true)
    expect(validationRules.embedding('true')).toBe(false)
    expect(validationRules.embedding(1)).toBe(false)
  })

  it('should validate n_parallel correctly', () => {
    expect(validationRules.n_parallel(2)).toBe(true)
    expect(validationRules.n_parallel(1)).toBe(true)
    expect(validationRules.n_parallel(0)).toBe(true)
    expect(validationRules.n_parallel(-1)).toBe(false)
    expect(validationRules.n_parallel('2')).toBe(false)
  })

  it('should validate cpu_threads correctly', () => {
    expect(validationRules.cpu_threads(4)).toBe(true)
    expect(validationRules.cpu_threads(1)).toBe(true)
    expect(validationRules.cpu_threads(0)).toBe(true)
    expect(validationRules.cpu_threads(-1)).toBe(false)
    expect(validationRules.cpu_threads('4')).toBe(false)
  })

  it('should validate prompt_template correctly', () => {
    expect(validationRules.prompt_template('template')).toBe(true)
    expect(validationRules.prompt_template('')).toBe(true)
    expect(validationRules.prompt_template(123)).toBe(false)
  })

  it('should validate llama_model_path correctly', () => {
    expect(validationRules.llama_model_path('path')).toBe(true)
    expect(validationRules.llama_model_path('')).toBe(true)
    expect(validationRules.llama_model_path(123)).toBe(false)
  })

  it('should validate mmproj correctly', () => {
    expect(validationRules.mmproj('mmproj')).toBe(true)
    expect(validationRules.mmproj('')).toBe(true)
    expect(validationRules.mmproj(123)).toBe(false)
  })

  it('should validate vision_model correctly', () => {
    expect(validationRules.vision_model(true)).toBe(true)
    expect(validationRules.vision_model(false)).toBe(true)
    expect(validationRules.vision_model('true')).toBe(false)
    expect(validationRules.vision_model(1)).toBe(false)
  })

  it('should validate text_model correctly', () => {
    expect(validationRules.text_model(true)).toBe(true)
    expect(validationRules.text_model(false)).toBe(true)
    expect(validationRules.text_model('true')).toBe(false)
    expect(validationRules.text_model(1)).toBe(false)
  })
})
