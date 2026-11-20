import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { ConversationHeaderTitle } from '../ConversationHeaderTitle'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to: _to, params: _params, ...props }: { children: ReactNode; to: string; params: unknown }) => <a {...props}>{children}</a>,
}))

describe('ConversationHeaderTitle', () => {
  const project = { id: 'qa-project', name: 'QA Postfix Assigned' }

  it('gives a project-only header all available width', () => {
    render(<ConversationHeaderTitle project={project} />)
    expect(screen.getByText(project.name)).toHaveClass('max-w-full')
    expect(screen.getByText(project.name)).not.toHaveClass('max-w-[40%]')
  })

  it('shares space when a conversation title is present', () => {
    render(<ConversationHeaderTitle project={project} title="Conversation" />)
    expect(screen.getByText(project.name)).toHaveClass('max-w-[40%]')
    expect(screen.getByText('Conversation')).toHaveAttribute('title', 'Conversation')
  })
})
