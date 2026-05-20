import type { RagCitation } from '@/components/Citations'

// Sentence boundary: a run of non-terminator chars (or terminators not
// followed by whitespace/end — e.g. the periods inside "e.g."), ending in a
// terminator that IS followed by whitespace/end. Fallback alternative
// catches trailing sentences with no closing terminator.
const SENTENCE_BOUNDARY =
  /((?:[^.!?\n]|[.!?](?!\s|$))+[.!?]+(?:["')\]]+)?(?=\s|$)|\S[^\n]*$)/g

const stripMarkdown = (s: string): string =>
  s
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+\.\s+/, '')
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/_{1,3}([^_\n]+)_{1,3}/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

export type Sentence = { formatted: string; plain: string }

export function splitSentences(text: string): Sentence[] {
  if (!text) return []
  const out: Sentence[] = []
  const re = new RegExp(SENTENCE_BOUNDARY.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const formatted = m[0].trim()
    if (!formatted) continue
    const plain = stripMarkdown(formatted)
    if (plain.length >= 12) out.push({ formatted, plain })
  }
  return out
}

export function cosine(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export type GroundingResult = {
  sentenceCitations: Record<string, number[]>
  citations: RagCitation[]
}

export async function computeGrounding(opts: {
  text: string
  citations: RagCitation[]
  embed: (texts: string[]) => Promise<number[][]>
  threshold?: number
  topK?: number
}): Promise<GroundingResult> {
  const { text, citations } = opts
  const threshold = opts.threshold ?? 0.65
  const topK = opts.topK ?? 1
  const sentences = splitSentences(text)
  if (!sentences.length || !citations.length) {
    return { sentenceCitations: {}, citations }
  }

  const chunkTexts = citations.map((c) => stripMarkdown(c.text || ''))
  const all = await opts.embed([
    ...sentences.map((s) => s.plain),
    ...chunkTexts,
  ])
  if (!all || all.length !== sentences.length + chunkTexts.length) {
    return { sentenceCitations: {}, citations }
  }
  const sentenceEmb = all.slice(0, sentences.length)
  const chunkEmb = all.slice(sentences.length)

  const map: Record<string, number[]> = {}
  for (let i = 0; i < sentences.length; i++) {
    const scored = chunkEmb
      .map((e, j) => ({ j, s: cosine(sentenceEmb[i], e) }))
      .filter((x) => x.s >= threshold)
      .sort((a, b) => b.s - a.s)
      .slice(0, topK)
      .map((x) => x.j)
    if (scored.length) map[sentences[i].formatted] = scored
  }

  return { sentenceCitations: map, citations }
}

const FENCE_RE = /```[\s\S]*?```/g
const INLINE_CODE_RE = /`[^`\n]+`/g

const SUP_DIGITS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹']
const toSuperscript = (n: number): string =>
  String(n)
    .split('')
    .map((d) => SUP_DIGITS[Number(d)] ?? d)
    .join('')

export function injectCitationMarkers(
  markdown: string,
  sentenceCitations: Record<string, number[]>,
  anchorPrefix: string
): string {
  if (!markdown || !Object.keys(sentenceCitations).length) return markdown

  const codeSpans: string[] = []
  const stashOne = (m: string) => {
    codeSpans.push(m)
    return ` §${codeSpans.length - 1}§ `
  }
  let stash = markdown.replace(FENCE_RE, stashOne).replace(INLINE_CODE_RE, stashOne)

  const sentences = Object.keys(sentenceCitations).sort(
    (a, b) => b.length - a.length
  )
  for (const sentence of sentences) {
    const indices = sentenceCitations[sentence]
    if (!indices?.length) continue
    const marker = indices
      .map(
        (i) =>
          `[${toSuperscript(i + 1)}](#${anchorPrefix}-${i + 1})`
      )
      .join('')
    const esc = sentence.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
    stash = stash.replace(new RegExp(esc), `${sentence}${marker}`)
  }

  stash = stash.replace(/ §(\d+)§ /g, (_, i) => codeSpans[Number(i)])
  return stash
}
