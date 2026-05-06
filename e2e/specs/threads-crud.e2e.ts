import { browser, $, expect } from '@wdio/globals'
import { byTestId, waitForApp } from '../helpers/app'
import { reloadAfterSeed, seedThread } from '../helpers/profile'

/**
 * Thread CRUD against a seeded profile. We write thread.json files
 * directly to the per-run XDG profile so the spec doesn't need a model.
 * Covers rename + delete; create-via-UI requires sending a first
 * message, which requires a model and lives under specs/manual/.
 */

const THREAD_A = 'a-thread-aaaaaaaa'
const THREAD_B = 'b-thread-bbbbbbbb'

describe('Threads: rename and delete', () => {
  before(async () => {
    seedThread({ id: THREAD_A, title: 'Pre-seeded thread A' })
    seedThread({ id: THREAD_B, title: 'Pre-seeded thread B' })
    await waitForApp()
    await reloadAfterSeed()
    await waitForApp()
    // Open the sidebar Chats group: the seeded threads have no project
    // metadata, so they land under NavChats.
    await byTestId(`thread-item-${THREAD_A}`, 30_000)
  })

  it('renames a thread via the sidebar dropdown', async () => {
    const more = await byTestId(`thread-more-${THREAD_A}`)
    await more.click()
    const rename = await byTestId(`thread-rename-${THREAD_A}`)
    await rename.click()

    const input = await byTestId('thread-rename-input', 10_000)
    await input.setValue('')
    await input.setValue('Renamed thread A')

    const confirm = await byTestId('thread-rename-confirm')
    await browser.waitUntil(async () => confirm.isEnabled(), {
      timeout: 5_000,
      timeoutMsg: 'rename confirm never enabled',
    })
    await confirm.click()

    await browser.waitUntil(
      async () => {
        const item = await $(`[data-testid="thread-item-${THREAD_A}"]`)
        return (await item.getText()).includes('Renamed thread A')
      },
      { timeout: 10_000, timeoutMsg: 'thread title did not update in sidebar' }
    )
  })

  it('deletes a thread via the sidebar dropdown', async () => {
    const more = await byTestId(`thread-more-${THREAD_B}`)
    await more.click()
    const del = await byTestId(`thread-delete-${THREAD_B}`)
    await del.click()

    const confirm = await byTestId('thread-delete-confirm', 10_000)
    await confirm.click()

    const item = await $(`[data-testid="thread-item-${THREAD_B}"]`)
    await item.waitForExist({ reverse: true, timeout: 10_000 })
    expect(await item.isExisting()).toBe(false)
  })
})
