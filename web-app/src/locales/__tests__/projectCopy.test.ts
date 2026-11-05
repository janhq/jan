import { describe, expect, it } from 'vitest'
import en from '../en/common.json'

describe('project copy', () => {
  // The empty state's heading already names the project; a long name repeated
  // in the sub-copy made the card unreadable.
  it('does not repeat the project name in the empty-state sub-copy', () => {
    expect(en.projects.noConversationsIn).toContain('{{projectName}}')
    expect(en.projects.sendMessageToStart).not.toContain('{{projectName}}')
  })
})
