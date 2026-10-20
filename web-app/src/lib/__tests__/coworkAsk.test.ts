import { describe, it, expect } from 'vitest'
import { parseAskRequest, renderAskResult } from '../coworkAsk'

const q = (over = {}) => ({
  id: 'q1',
  question: 'Which?',
  options: [{ label: 'A' }, { label: 'B' }],
  ...over,
})

describe('parseAskRequest', () => {
  it('accepts a well-formed request', () => {
    const out = parseAskRequest({ questions: [q()] })
    expect(typeof out).not.toBe('string')
    expect((out as { questions: unknown[] }).questions).toHaveLength(1)
  })

  it('keeps multi and recommended when present', () => {
    const out = parseAskRequest({
      questions: [q({ multi: true, recommended: 1 })],
    }) as { questions: Array<{ multi?: boolean; recommended?: number }> }
    expect(out.questions[0].multi).toBe(true)
    expect(out.questions[0].recommended).toBe(1)
  })

  it('drops multi and recommended when absent rather than inventing them', () => {
    const out = parseAskRequest({ questions: [q()] }) as {
      questions: Array<Record<string, unknown>>
    }
    expect('multi' in out.questions[0]).toBe(false)
    expect('recommended' in out.questions[0]).toBe(false)
  })

  // A card the user cannot answer would stall the run forever, so a malformed
  // request has to come back as a tool error the model can correct.
  it('rejects requests that would render an unanswerable card', () => {
    expect(typeof parseAskRequest({})).toBe('string')
    expect(typeof parseAskRequest({ questions: [] })).toBe('string')
    expect(typeof parseAskRequest({ questions: [q({ id: '' })] })).toBe('string')
    expect(typeof parseAskRequest({ questions: [q({ question: '' })] })).toBe(
      'string'
    )
    expect(
      typeof parseAskRequest({ questions: [q({ options: [{ label: 'only' }] })] })
    ).toBe('string')
  })

  it('rejects a question whose options are unlabelled', () => {
    const out = parseAskRequest({
      questions: [q({ options: [{ description: 'x' }, { description: 'y' }] })],
    })
    expect(typeof out).toBe('string')
  })
})

describe('renderAskResult', () => {
  it('serialises the answers', () => {
    const answers = [{ id: 'q1', selected: ['A'] }]
    expect(JSON.parse(renderAskResult(answers).output)).toEqual(answers)
  })

  // An empty array reads as "the user chose nothing", which is different from
  // "the user never answered" and sends the model down the wrong path.
  it('says plainly when the user did not answer', () => {
    const out = renderAskResult(null)
    expect(out.output).toMatch(/did not answer/)
    expect(out.output).toMatch(/best judgement/)
    expect(out.isError).toBeUndefined()
  })
})
