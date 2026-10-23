import { describe, it, expect } from 'vitest'
import { parseAskRequest, renderAskResult, summarizeAsk } from '../coworkAsk'

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

describe('parseAskRequest hardening', () => {
  type Parsed = { questions: Array<{ options: { label: string }[]; recommended?: number }> }

  it('rejects duplicate question ids and duplicate option labels', () => {
    expect(typeof parseAskRequest({ questions: [q(), q()] })).toBe('string')
    expect(
      typeof parseAskRequest({
        questions: [q({ options: [{ label: 'A' }, { label: 'A' }] })],
      })
    ).toBe('string')
  })

  it('keeps recommended on the same option when a blank one is dropped', () => {
    const out = parseAskRequest({
      questions: [
        q({ options: [{ label: '' }, { label: 'A' }, { label: 'B' }], recommended: 1 }),
      ],
    }) as Parsed
    expect(out.questions[0].options[out.questions[0].recommended!].label).toBe('A')
  })

  it('drops an out-of-range recommended index', () => {
    const out = parseAskRequest({ questions: [q({ recommended: 7 })] }) as Parsed
    expect(out.questions[0].recommended).toBeUndefined()
  })

  it('reads a "(Recommended)" label suffix as the field and strips it', () => {
    const out = parseAskRequest({
      questions: [q({ options: [{ label: 'A' }, { label: 'B (Recommended)' }] })],
    }) as Parsed
    expect(out.questions[0].options.map((o) => o.label)).toEqual(['A', 'B'])
    expect(out.questions[0].recommended).toBe(1)
  })
})

describe('summarizeAsk', () => {
  const input = {
    questions: [q(), q({ id: 'q2', question: 'Which ones?', multi: true })],
  }

  it('pairs each question with its picks, joining multi-select labels', () => {
    const output = renderAskResult([
      { id: 'q1', selected: ['A'] },
      { id: 'q2', selected: ['A', 'B'] },
    ]).output
    expect(summarizeAsk(input, output)).toEqual([
      { question: 'Which?', answer: 'A' },
      { question: 'Which ones?', answer: 'A, B' },
    ])
  })

  it('shows free text in place of picks', () => {
    const output = renderAskResult([
      { id: 'q1', selected: [], custom_input: ' my own ' },
      { id: 'q2', selected: ['B'] },
    ]).output
    expect(summarizeAsk(input, output)?.[0].answer).toBe('my own')
  })

  it('marks every question unanswered when the card was dismissed', () => {
    const output = renderAskResult(null).output
    expect(summarizeAsk(input, output)?.map((r) => r.answer)).toEqual([null, null])
  })

  it('does not pass off a partial answer set as skips', () => {
    const output = renderAskResult([{ id: 'q1', selected: ['A'] }]).output
    expect(summarizeAsk(input, output)).toBeNull()
  })

  it('gives up on output it cannot read', () => {
    expect(summarizeAsk(input, 'not json')).toBeNull()
    expect(summarizeAsk({}, '[]')).toBeNull()
  })
})
