import { describe, expect, it } from 'vitest'
import {
  filterSkillCommands,
  parseSkillCommand,
  resolveSkillCommand,
} from '@/lib/skillCommands'

describe('skill slash commands', () => {
  const skills = [
    { name: 'deploy', description: 'Ship the app', user_invocable: true },
    { name: 'private', description: 'Internal only', user_invocable: false },
    { name: 'lint', description: 'Run lint', user_invocable: true },
  ]

  it('parses explicit and short forms with arguments', () => {
    expect(parseSkillCommand('/skill:deploy staging --force')).toEqual({
      name: 'deploy',
      args: 'staging --force',
      explicit: true,
    })
    expect(parseSkillCommand('/lint changed files')).toEqual({
      name: 'lint',
      args: 'changed files',
      explicit: false,
    })
  })

  it('does not treat ordinary text as a skill command', () => {
    expect(parseSkillCommand('please fix /skill:deploy')).toBeNull()
    expect(parseSkillCommand('/')).toBeNull()
  })

  it('filters unavailable and non-user-invocable skills for the popup', () => {
    expect(filterSkillCommands(skills, 'de')).toEqual([skills[0]])
    expect(filterSkillCommands(skills, '')).toEqual([skills[0], skills[2]])
  })

  it('resolves short names and keeps explicit names unambiguous', () => {
    expect(resolveSkillCommand(skills, { name: 'deploy', args: '', explicit: false })).toEqual(
      skills[0]
    )
    expect(resolveSkillCommand(skills, { name: 'missing', args: '', explicit: true })).toBeNull()
  })
})
