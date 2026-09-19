import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { browser, expect, $, $$ } from '@wdio/globals'

import {
  ASSISTANT_MESSAGES,
  sendPrompt,
  USER_MESSAGES,
} from '../helpers/chat.js'
import { clickWhenReady } from '../helpers/interactions.js'
import {
  MOCK_MODEL_ID,
  MOCK_REPLY_PREFIX,
  MOCK_TITLE,
  startMockOpenAI,
  type MockOpenAI,
} from '../helpers/mock-openai.js'
import { goto } from '../helpers/navigation.js'
import { janUserDataDir } from '../helpers/paths.js'
import {
  configureMockProvider,
  denyAnalyticsConsent,
  selectModel,
} from '../helpers/provider.js'

// The worker inherits this from the launcher; see wdio.conf.ts. Read from the
// environment rather than importing the config, so the spec does not trigger a
// second evaluation of a module with top-level side effects.
const testHome = process.env.JAN_E2E_HOME!

const PROVIDER_NAME = 'e2e-mock-provider'

// Deliberately unalike, and unalike in their first word: when the echo assertion
// fails, the diff has to say which turn produced the text without being read
// twice.
const FIRST_PROMPT = 'first turn ping from the e2e suite'
const SECOND_PROMPT = 'second turn pong from the e2e suite'

/**
 * The manual QA checklist's critical path: configure a provider, send, stream a
 * reply, send again, survive a reload, delete the thread.
 *
 * The three tests share one thread and run in order -- test 1 creates it and
 * captures `threadId`, tests 2 and 3 address it. Mocha runs them in declaration
 * order, so this is stated rather than defended against; splitting them into
 * independent tests would mean configuring a provider and streaming two replies
 * three times over to assert the same thing.
 */
describe('chat critical path', () => {
  let mock: MockOpenAI

  // Written by test 1, read by tests 2 and 3.
  let threadId = ''

  before(async () => {
    mock = await startMockOpenAI()

    await $('#root').waitForExist({ timeout: 60_000 })

    await configureMockProvider(mock, PROVIDER_NAME)

    // This is the spec that completes onboarding, so the consent panel must be
    // here; see the helper for why `required` is not always true.
    await denyAnalyticsConsent({ required: true })
  })

  after(async () => {
    // Non-negotiable: an open listener keeps the wdio worker's event loop alive
    // and the run never exits, long after the last assertion has passed.
    //
    // Guarded because after() still runs when before() threw: if startMockOpenAI
    // itself failed, an unguarded close() throws "Cannot read properties of
    // undefined" and that is the error the report shows instead of the real one.
    if (mock) await mock.close()
  })

  it('sends a prompt and renders the streamed reply', async () => {
    await goto('/')

    // A single model on a custom provider is enough for hasUsableProvider()
    // (routes/index.tsx:52), so `/` renders the composer instead of SetupScreen
    // without any working credential.
    await selectModel(MOCK_MODEL_ID)

    await sendPrompt(FIRST_PROMPT)

    // The echo is the whole assertion. MOCK_REPLY_PREFIX followed by exactly
    // what was typed can only appear if the prompt reached the mock over
    // tauri-plugin-http and the SSE chunks were reassembled in the webview;
    // asserting that *some* bubble rendered would pass on an error state.
    const reply = await $(ASSISTANT_MESSAGES)
    await reply.waitForDisplayed({
      timeout: 60_000,
      timeoutMsg:
        'no assistant message appeared after sending the first prompt. The ' +
        'mock logs a 404 body for any route it was not asked to answer, so ' +
        'check for an unexpected path before suspecting the stream itself.',
    })
    await expect(reply).toHaveText(
      expect.stringContaining(MOCK_REPLY_PREFIX + FIRST_PROMPT)
    )

    // The first send creates the thread and the router lands on /threads/<id>.
    // Everything after this addresses the thread by that id -- in the sidebar
    // and on disk -- so capture it here rather than re-deriving it later.
    await browser.waitUntil(
      async () => {
        const path = await browser.execute(() => window.location.pathname)
        threadId = path.startsWith('/threads/')
          ? path.slice('/threads/'.length)
          : ''
        return threadId.length > 0
      },
      {
        timeout: 30_000,
        timeoutMsg:
          'the router never moved to /threads/<id> after the first send, so ' +
          'the remaining tests have no thread id to work with.',
      }
    )

    // Wait out the generated title here, while the thread still has exactly one
    // reply, because this is the only moment it is deterministic.
    //
    // The summarizer is fire-and-forget from onFinish and runs only on a refresh
    // tick -- the first assistant message, then every fourth
    // (routes/threads/$threadId.tsx:632-635). Sending the next turn aborts
    // whatever is in flight (line 957; thread-title-summarizer.ts swallows the
    // AbortError and returns null). So with two assistant messages there is no
    // second attempt: lose that race once and the row reads "New Thread" for the
    // rest of the run, which is a failure no retry can recover.
    //
    // It also belongs here on its own merits -- a title appearing is what the
    // first reply is supposed to trigger.
    await expect($(`[data-testid="thread-row-${threadId}"]`)).toHaveText(
      expect.stringContaining(MOCK_TITLE),
      {
        message:
          'the thread was never titled. The summarizer is the one non-streaming ' +
          'completion the mock answers, so a 404 or a changed request shape ' +
          'shows up here and nowhere else.',
      }
    )
  })

  it('keeps every turn across a webview reload', async () => {
    await sendPrompt(SECOND_PROMPT)

    await expect($$(USER_MESSAGES)).toBeElementsArrayOfSize(2)
    await expect($$(ASSISTANT_MESSAGES)).toBeElementsArrayOfSize(2)

    // The second bubble exists as soon as the stream opens, so the count above
    // can be satisfied by a half-written reply; this is what waits for the echo
    // of the *second* prompt specifically, and pins the ordering while it is at
    // it.
    // getElements() rather than indexing the chainable $$ result: it resolves to
    // a plain array, so `.length` here is a number and not a promise.
    const replies = await $$(ASSISTANT_MESSAGES).getElements()
    await expect(replies[replies.length - 1]).toHaveText(
      expect.stringContaining(MOCK_REPLY_PREFIX + SECOND_PROMPT)
    )

    // Reload from `/`, and only from `/`. browser.refresh() re-requests whatever
    // is in the address bar; our routes are pushState-only and the Tauri asset
    // protocol has no SPA fallback, so refreshing at /threads/<id> asks it for a
    // deep path and 404s into a dead window. That is the same reason goto()
    // exists instead of browser.url(). Shallow first, then reload, then push
    // back in -- this ordering is load-bearing, not incidental.
    await goto('/')
    await browser.refresh()

    await $('#root').waitForExist({ timeout: 60_000 })
    // Not just #root: the selector renders only once React has mounted *and*
    // hasUsableProvider() is true again, so it proves the provider came back out
    // of persisted settings rather than out of the zustand stores the reload
    // just threw away.
    await $('[data-testid="model-selector-trigger"]').waitForDisplayed({
      timeout: 60_000,
      timeoutMsg:
        'the app never came back up at `/` with a usable provider after ' +
        'browser.refresh(). A blank window here usually means the refresh ran ' +
        'from a deep path and the asset protocol 404ed it.',
    })

    await goto(`/threads/${threadId}`)

    // The payoff. This process holds no in-memory copy of the conversation any
    // more, so two turns -- four messages -- rendering here means they were read
    // back out of the Rust-side thread store.
    await expect($$(USER_MESSAGES)).toBeElementsArrayOfSize(2)
    await expect($$(ASSISTANT_MESSAGES)).toBeElementsArrayOfSize(2)

    const restored = await $$(ASSISTANT_MESSAGES).getElements()
    await expect(restored[0]).toHaveText(
      expect.stringContaining(MOCK_REPLY_PREFIX + FIRST_PROMPT)
    )
    await expect(restored[1]).toHaveText(
      expect.stringContaining(MOCK_REPLY_PREFIX + SECOND_PROMPT)
    )

    // The same row after the reload. The title is part of what had to survive,
    // and this one cannot be the summarizer doing the work a second time: it
    // does not run again at two assistant messages. Test 1 already waited for it
    // to arrive, so nothing here is racing anything.
    await expect($(`[data-testid="thread-row-${threadId}"]`)).toHaveText(
      expect.stringContaining(MOCK_TITLE)
    )
  })

  it('deletes the thread from the sidebar and from disk', async () => {
    const rowSelector = `[data-testid="thread-row-${threadId}"]`
    const threadDir = join(janUserDataDir(testHome), 'threads', threadId)

    // Establish the directory is there before deleting it. Without this the
    // check at the end of this test passes for a thread id that was never
    // right -- a path that never existed does not exist afterwards either.
    await browser.waitUntil(() => existsSync(threadDir), {
      timeout: 30_000,
      timeoutMsg:
        `${threadDir} does not exist, so the delete assertion below would ` +
        'prove nothing. Either the thread id captured in the first test is ' +
        'wrong, or threads are no longer stored one directory per id ' +
        '(src-tauri/src/core/threads/utils.rs).',
    })

    const row = await $(rowSelector)
    await row.waitForDisplayed({ timeout: 30_000 })

    // Opening this menu is the one genuinely awkward interaction in the suite,
    // and both halves of the awkwardness come from the embedded driver rather
    // than from Jan.
    //
    // The driver has no real input: dispatch_pointer_event() builds a MouseEvent
    // in JS and dispatches it at the coordinates, and click_element() is
    // `el.click()` followed by `el.focus()` (tauri-plugin-wdio-webdriver,
    // src/platform/executor.rs). Nothing it does produces a PointerEvent, and a
    // synthesized MouseEvent does not move CSS :hover.
    //
    // So: this trigger is `md:opacity-0` until its row is hovered
    // (SidebarMenuAction showOnHover, components/ui/sidebar.tsx:713) and no
    // amount of moveTo() will reveal it, while Radix's DropdownMenuTrigger opens
    // on pointerdown, which never arrives -- a plain click leaves the menu shut
    // and the failure reads as "element still not clickable", naming an element
    // that is present and enabled.
    //
    // The keyboard path sidesteps both. The click's el.focus() satisfies the
    // rule's `group-focus-within/menu-item:opacity-100` arm, and Radix's trigger
    // also opens on Enter -- which is the route a keyboard user takes anyway.
    // Deliberately no waitForClickable here: it would reject the opacity-0
    // element before the focus that fixes it has happened.
    const threadMenu = await $(`[data-testid="thread-menu-${threadId}"]`)
    await threadMenu.waitForExist({ timeout: 30_000 })
    await threadMenu.click()
    await browser.keys('Enter')

    const deleteItem = await $('[data-testid="thread-delete"]')
    await deleteItem.waitForDisplayed({
      timeout: 30_000,
      timeoutMsg:
        'the thread overflow menu never opened. Radix renders its content only ' +
        'while open, so this selector finding nothing means the Enter above did ' +
        'not reach the trigger -- check that the click focused it.',
    })
    await deleteItem.click()

    await clickWhenReady('[data-testid="confirm-delete-thread"]')

    // Re-query rather than reusing `row`: the node is gone, and the assertion
    // should be about the selector finding nothing, not about a stale reference.
    await expect($(rowSelector)).not.toBeExisting()

    // This is the half that covers the checklist's "stays deleted even after a
    // restart". The row vanishing only proves the zustand store dropped it, and
    // a webview reload is not a process restart, so nothing else in this spec
    // would notice a directory left behind for the next launch to re-read.
    // delete_thread is a remove_dir_all
    // (src-tauri/src/core/threads/commands.rs:121-137), so the directory going
    // away is also the proof the IPC call reached Rust at all.
    await browser.waitUntil(() => !existsSync(threadDir), {
      timeout: 30_000,
      timeoutMsg:
        `${threadDir} still exists after the delete was confirmed. The UI ` +
        'dropped the thread but the on-disk copy survives, so it comes back on ' +
        'the next launch -- check delete_thread in core/threads/commands.rs and ' +
        'the caller that invokes it.',
    })
  })
})
