import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConversationCapabilitiesConsent } from '../ConversationCapabilitiesConsent'
import { defaultConversationCapabilities, type ConversationCapabilitiesV1 } from '@/lib/conversationCapabilities'

function setup(pick = vi.fn<() => Promise<string | null>>().mockResolvedValue('/synthetic/project')) {
  const changed = vi.fn()
  function Draft() {
    const [value, setValue] = useState<ConversationCapabilitiesV1>(defaultConversationCapabilities())
    return <ConversationCapabilitiesConsent value={value} onPickFolder={pick} onChange={(next) => { changed(next); setValue(next) }} />
  }
  render(<Draft />)
  return { pick, changed }
}
const writes = () => screen.getByRole('checkbox', { name: 'Allow changes to files in this folder' })

describe('pending conversation consent', () => {
  it('starts denied and requires explicit folder selection before independent write consent', async () => {
    const { changed } = setup()
    expect(writes()).toBeDisabled()
    expect(changed).not.toHaveBeenCalled()
    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder to read' }))
    await screen.findByText('Read only: /synthetic/project')
    expect(writes()).not.toBeChecked()
    fireEvent.click(writes())
    expect(screen.getByText('Read and write: /synthetic/project')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /shell commands/ })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /durable memory/ })).not.toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: /shell commands/ }))
    expect(screen.getByRole('checkbox', { name: /durable memory/ })).not.toBeChecked()
  })
  it('cancel preserves prior selection, completed reselect resets writes, remove clears folder', async () => {
    const { pick } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder to read' }))
    await screen.findByText('Read only: /synthetic/project')
    fireEvent.click(writes())
    pick.mockResolvedValueOnce(null)
    fireEvent.click(screen.getByRole('button', { name: 'Change folder' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change folder' })).not.toBeDisabled())
    expect(writes()).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Change folder' }))
    await waitFor(() => expect(writes()).not.toBeChecked())
    fireEvent.click(screen.getByRole('button', { name: 'Remove folder' }))
    expect(screen.getByText('No folder access selected.')).toBeInTheDocument()
    expect(writes()).toBeDisabled()
  })
  it('refuses malformed picker output and surfaces picker failure without granting', async () => {
    const { pick, changed } = setup(vi.fn().mockResolvedValue('/bad/../path'))
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder to read' }))
    await screen.findByRole('alert')
    expect(changed).not.toHaveBeenCalled()
    pick.mockRejectedValueOnce(new Error('synthetic'))
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder to read' }))
    await screen.findByText('Could not select a folder. Try again.')
    expect(changed).not.toHaveBeenCalled()
  })
  it('ignores stale picker response after draft changes', async () => {
    let complete!: (path: string) => void
    const pick = vi.fn(() => new Promise<string>((resolve) => { complete = resolve }))
    const changed = vi.fn()
    const value = defaultConversationCapabilities()
    const view = render(<ConversationCapabilitiesConsent value={value} onChange={changed} onPickFolder={pick} />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder to read' }))
    view.rerender(<ConversationCapabilitiesConsent value={{ ...value, memoryWrite: true }} onChange={changed} onPickFolder={pick} />)
    await act(async () => complete('/synthetic/project'))
    expect(changed).not.toHaveBeenCalled()
  })
  it.each(['unmount', 'disable then enable'])('invalidates picker on %s', async (transition) => {
    let complete!: (path: string) => void
    const pick = vi.fn(() => new Promise<string>((resolve) => { complete = resolve }))
    const changed = vi.fn()
    const value = defaultConversationCapabilities()
    const view = render(<ConversationCapabilitiesConsent value={value} onChange={changed} onPickFolder={pick} />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder to read' }))
    if (transition === 'unmount') view.unmount()
    else {
      view.rerender(<ConversationCapabilitiesConsent value={value} onChange={changed} onPickFolder={pick} disabled />)
      view.rerender(<ConversationCapabilitiesConsent value={value} onChange={changed} onPickFolder={pick} />)
    }
    await act(async () => complete('/synthetic/project'))
    expect(changed).not.toHaveBeenCalled()
  })

})
