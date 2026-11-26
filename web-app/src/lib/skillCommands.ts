export type SkillCommandMeta = {
  name: string
  description: string
  user_invocable?: boolean
}

export type ParsedSkillCommand = {
  name: string
  args: string
  explicit: boolean
}

export function parseSkillCommand(text: string): ParsedSkillCommand | null {
  const trimmed = text.trim()
  const match = trimmed.match(/^\/(?:skill:)?([^\s/]+)(?:\s+([\s\S]*))?$/)
  if (!match || !match[1]) return null
  return {
    name: match[1],
    args: match[2]?.trim() ?? '',
    explicit: trimmed.startsWith('/skill:'),
  }
}

export function filterSkillCommands(
  skills: SkillCommandMeta[],
  query: string
): SkillCommandMeta[] {
  const normalized = query.toLowerCase()
  return skills.filter(
    (skill) =>
      skill.user_invocable !== false && skill.name.toLowerCase().includes(normalized)
  )
}

export function resolveSkillCommand(
  skills: SkillCommandMeta[],
  parsed: ParsedSkillCommand
): SkillCommandMeta | null {
  const available = skills.filter((skill) => skill.user_invocable !== false)
  const exact = available.find((skill) => skill.name === parsed.name)
  if (exact) return exact
  if (parsed.explicit) return null
  const matches = available.filter((skill) => {
    const plain = skill.name.includes(':') ? skill.name.split(':').pop() : skill.name
    return plain === parsed.name
  })
  return matches.length === 1 ? matches[0] : null
}

export function skillCommandPrefix(
  text: string,
  skills: SkillCommandMeta[]
): string | null {
  const match = text.match(/^\/(?:skill:)?([^\s/]+)/)
  if (!match) return null
  const parsed = parseSkillCommand(text)
  if (!parsed || !resolveSkillCommand(skills, parsed)) return null
  return match[0]
}
