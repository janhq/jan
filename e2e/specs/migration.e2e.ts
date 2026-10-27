import { browser, $, $$, expect } from '@wdio/globals'
import { assertFixture, assertMigrated, historicalThread } from '../migration.js'
import { goto } from '../helpers/navigation.js'
import { USER_MESSAGES, ASSISTANT_MESSAGES } from '../helpers/chat.js'

const home = process.env.JAN_E2E_HOME!
describe(`0.8.3 migration, process start ${process.env.JAN_E2E_MIGRATION_PHASE}`, () => {
  it('records schema 5, removes only Exa, and preserves all fixture threads and messages', async () => {
    assertFixture()
    await browser.waitUntil(() => {
      try { assertMigrated(home); return true } catch { return false }
    }, { timeout: 30_000, timeoutMsg: 'Migration never reached expected fixture state' })
    assertMigrated(home)
  })

  it('renders the historical user and assistant messages without configuring a provider', async () => {
    // A mounted root precedes extension registration and thread hydration.
    // The historical row only exists once fetchThreads has completed.
    await $(`[data-testid="thread-row-${historicalThread}"]`).waitForExist({ timeout: 60_000 })
    await goto(`/threads/${historicalThread}`)
    await expect($$(USER_MESSAGES)).toBeElementsArrayOfSize(1)
    await expect($$(ASSISTANT_MESSAGES)).toBeElementsArrayOfSize(1)
    const users = await $$(USER_MESSAGES).getElements()
    const assistants = await $$(ASSISTANT_MESSAGES).getElements()
    await expect(users[0]).toHaveText(expect.stringContaining('QA thread 1 created on v0.8.3 - confirm mock roundtrip'))
    await expect(assistants[0]).toHaveText(expect.stringContaining('QA reply at 15:46:46 to: QA thread 1 created on v0.8.3 - confirm mock roundtrip'))
    assertMigrated(home)
  })
})
