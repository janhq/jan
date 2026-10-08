import { browser, expect, $, $$ } from '@wdio/globals'

import {
  ASSISTANT_MESSAGES,
  sendPrompt,
  USER_MESSAGES,
  waitForStreamToFinish,
} from '../helpers/chat.js'
import { MOCK_REPLY_PREFIX, startMockOpenAI } from '../helpers/mock-openai.js'
import type { MockOpenAI } from '../helpers/mock-openai.js'
import { goto } from '../helpers/navigation.js'
import {
  configureMockProvider,
  denyAnalyticsConsent,
  selectModel,
} from '../helpers/provider.js'

// A provider and a model id of this spec's own, not chat.e2e.ts's.
//
// Both are needed. Nothing removes an earlier spec's provider, so its entry is
// still in the profile -- but its mock server was closed in that spec's after(),
// so its base URL now points at nothing. And the model id has to differ because
// the chat dropdown keys its option testid on the id alone
// (DropdownModelProvider.tsx:584,684): two providers offering `jan-e2e-mock`
// would put two elements behind `model-option-jan-e2e-mock` and selectModel()
// would be picking between a live server and a dead one by luck.
const PROVIDER_NAME = 'e2e-actions-provider'
const MODEL_ID = 'jan-e2e-actions'

const OPENING_PROMPT = 'opening turn for the message actions spec'
const EDITED_PROMPT = 'edited turn for the message actions spec'

// Long enough that the echo is many chunks rather than a handful, so the stop
// test has a stream to interrupt rather than a race to lose.
const LONG_PROMPT =
  'this prompt is deliberately long so that the echoed reply arrives as many ' +
  'separate chunks and the stop button has something to interrupt'

/**
 * Milliseconds per chunk while the stop test needs a slow stream.
 *
 * 600 and not 400 because of the slowest leg rather than this machine. The echo
 * is 26 word-chunks, so this paces roughly 15s of stream, against a stop path
 * -- first-word detection on a 500ms poll, then waitForDisplayed, then the
 * click -- that costs 2-3s here and closer to 5s on windows-11-arm. It is free
 * on a green run: the stream is aborted a few seconds in and the remaining
 * delay is never spent. Losing that race does not fail here either, it fails
 * 30s later at the Continue-button wait, blaming message queueing, on the
 * platform least convenient to debug.
 */
const SLOW_CHUNK_MS = 600

// Derived rather than written out, so it cannot drift from what the mock sends.
// The reply streams a word at a time, so this is the first thing to appear.
const FIRST_REPLY_WORD = MOCK_REPLY_PREFIX.trim().split(' ')[0]

/**
 * The second chapter of the chat critical path: what a user does to a message
 * *after* it has been sent.
 *
 * chat.e2e.ts covers send/stream/persist/delete-the-thread. These are the
 * in-thread actions from the manual QA checklist's "In a thread" section --
 * Regenerate, edit-and-regenerate, delete a message -- plus stopping a reply
 * mid-flight, and New Chat, which the checklist calls out as "the user can
 * immediately chat with the model".
 *
 * Like chat.e2e.ts the tests share one thread and run in declaration order.
 * Each leaves the transcript in the state the next expects, which is stated
 * rather than defended against: the alternative is streaming a reply from
 * scratch six times over to assert six things about the same conversation.
 */
describe('message actions', () => {
  let mock: MockOpenAI

  // Written by before(), read by the New Chat test, which has to prove the
  // thread it lands on is a *different* one.
  let threadId = ''

  before(async () => {
    mock = await startMockOpenAI({ modelId: MODEL_ID })

    await $('#root').waitForExist({ timeout: 60_000 })

    await configureMockProvider(mock, PROVIDER_NAME)
    // Not required: the panel appears once per profile and chat.e2e.ts already
    // answered it earlier in this same app process. Insisting on it here would
    // hang for the full timeout.
    await denyAnalyticsConsent({ required: false })

    await goto('/')
    await selectModel(MODEL_ID)

    await sendPrompt(OPENING_PROMPT)
    await expect($(ASSISTANT_MESSAGES)).toHaveText(
      expect.stringContaining(MOCK_REPLY_PREFIX + OPENING_PROMPT)
    )
    await waitForStreamToFinish()

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
          'the router never moved to /threads/<id> after the opening send, so ' +
          'the New Chat test has nothing to compare its new thread against.',
      }
    )
  })

  after(async () => {
    // Non-negotiable: an open listener keeps the wdio worker's event loop alive
    // and the run never exits, long after the last assertion has passed.
    // Guarded because after() still runs when before() threw.
    if (mock) await mock.close()
  })

  /**
   * The version counter on the one visible assistant message, e.g. `2/2`.
   *
   * Absent entirely until a fork exists -- MessageItem.tsx:509 renders the whole
   * nav only when `versionInfo.count > 1` -- so "no such element" here means no
   * branch was created, which is a more useful failure than a text mismatch.
   */
  async function assistantVersionCounter() {
    const counter = await $(
      `${ASSISTANT_MESSAGES} [data-testid="message-version-counter"]`
    )
    await counter.waitForExist({
      timeout: 30_000,
      timeoutMsg:
        'the assistant message has no version counter, so no second version ' +
        'was created. The nav only renders once a message has siblings ' +
        '(MessageItem.tsx:509), so this means the branch itself is missing ' +
        'rather than that it is showing the wrong number.',
    })
    return counter
  }

  it('regenerates the last reply and asks the model again', async () => {
    const asked = mock.streamedPrompts.length

    // Unique without scoping: the button renders only on the last assistant
    // message and only while nothing is streaming (MessageItem.tsx:716-719).
    await $('[data-testid="regenerate-message"]').click()

    // The reason this assertion is on the server and not on the DOM: the
    // regenerated reply answers an unchanged prompt, so it is byte-identical to
    // the one it replaced. Nothing visible distinguishes "asked again" from
    // "re-rendered what was already there", and "asked again" is the entire
    // claim Regenerate makes.
    await browser.waitUntil(
      () => mock.streamedPrompts.length === asked + 1,
      {
        timeout: 60_000,
        timeoutMsg:
          'clicking Regenerate did not produce another streaming completion. ' +
          'The button was there and enabled, so the click reached a handler ' +
          'that decided not to call the model.',
      }
    )
    expect(mock.streamedPrompts.at(-1)).toBe(OPENING_PROMPT)

    await waitForStreamToFinish()

    // Branching, not appending: handleRegenerate keeps the old reply as a
    // sibling and makes the new one active ($threadId.tsx:1355-1384), so the
    // transcript still shows one reply and the counter is what says there are
    // two of them.
    await expect($$(ASSISTANT_MESSAGES)).toBeElementsArrayOfSize(1)
    await expect(await assistantVersionCounter()).toHaveText('2/2')
  })

  it('switches back to the previous version without asking again', async () => {
    const asked = mock.streamedPrompts.length

    await $('[data-testid="message-version-prev"]').click()
    await expect(await assistantVersionCounter()).toHaveText('1/2')

    // The half worth having. Switching versions reads a reply the thread
    // already holds, so a request here would mean the app had thrown the old
    // one away and was re-deriving it -- which would also make the two versions
    // impossible to compare, since the model is free to answer differently.
    //
    // Read after a pause, not immediately: the counter flips from local state,
    // so a request fired a moment behind it would slip past a snapshot taken
    // the instant the DOM settles. Asserting a negative needs a window for the
    // thing to fail to happen in.
    await browser.pause(500)
    expect(mock.streamedPrompts.length).toBe(asked)
  })

  it('re-runs the model when a user message is edited', async () => {
    const asked = mock.streamedPrompts.length

    const userMessage = await $(USER_MESSAGES)
    const editTrigger = await userMessage.$(
      '[data-testid="edit-message-trigger"]'
    )

    // waitForExist and a bare click, deliberately. The user-side action row is
    // `opacity-0 ... group-hover/message:opacity-100 focus-within:opacity-100`
    // (MessageItem.tsx:631) and this driver cannot produce the hover half -- a
    // synthesized MouseEvent does not move CSS :hover. waitForDisplayed() would
    // reject a fully transparent element, so anything that waits for visibility
    // here times out on a control that works.
    //
    // The click itself is fine through the transparency: elementClick is
    // `el.scrollIntoView(); el.click(); el.focus()` in JS, and DialogTrigger
    // opens on onClick rather than the pointerdown that Radix's *dropdown*
    // trigger wants. The trailing focus() is also what satisfies focus-within,
    // so the row is opaque from here on.
    await editTrigger.waitForExist({ timeout: 30_000 })
    await editTrigger.click()

    await $('[data-testid="edit-message-dialog"]').waitForDisplayed({
      timeout: 30_000,
      timeoutMsg:
        'the edit dialog never opened. The trigger exists but is transparent ' +
        'until focused, so if the click landed the dialog should follow -- ' +
        'check it is not disabled, which it is whenever no model is selected.',
    })

    // Wait for the dialog's *focus* timer, not for the text.
    //
    // The obvious wait -- poll until the textarea holds the original prompt --
    // closes nothing, and is worth spelling out because it looks like it does.
    // `draft` is seeded by `useState(initialCleanPrompt)`
    // (EditMessageDialog.tsx:41) so the field holds the text on its very first
    // paint, and that poll returns on its first attempt. (The effect at :47-52
    // re-seeds it from the same source; it runs after paint and changes
    // nothing here.) The thing worth waiting for is the *separate* effect at
    // :54-61, which focus()es and select()s the textarea 100ms after open.
    // Landing in the middle of typing, that select() makes the following
    // keystrokes replace the selection, and the field ends up holding a suffix
    // of what was typed.
    //
    // So wait for the element to actually be focused, which is the observable
    // edge of that timer, and only then type.
    const input = await $('[data-testid="edit-message-input"]')
    await browser.waitUntil(async () => await input.isFocused(), {
      timeout: 30_000,
      timeoutMsg:
        'the edit dialog never focused its textarea, so the 100ms select() has ' +
        'not run yet and anything typed now could be half-replaced by it ' +
        '(EditMessageDialog.tsx:54-61).',
    })
    await expect(input).toHaveValue(OPENING_PROMPT)

    await input.setValue(EDITED_PROMPT)
    // Confirm the field holds exactly what was typed before submitting it. If
    // the select() above still managed to land mid-keystroke this is where it
    // shows, naming the cause, rather than surfacing later as the model having
    // been asked a truncated question.
    await expect(input).toHaveValue(EDITED_PROMPT)

    // Save is disabled while the draft is unchanged (EditMessageDialog.tsx:174-181),
    // so it being enabled is itself the proof the field took the new text.
    const save = await $('[data-testid="edit-message-save"]')
    await save.waitForEnabled({ timeout: 30_000 })
    await save.click()

    await browser.waitUntil(() => mock.streamedPrompts.length === asked + 1, {
      timeout: 60_000,
      timeoutMsg:
        'saving an edited user message did not re-run the model. ' +
        'handleEditMessage only regenerates for role === "user" ' +
        '($threadId.tsx:1430), so a silent no-op here means the edit was ' +
        'applied to something else.',
    })
    // The edited text, not the original -- this is what says the model was
    // asked the new question rather than asked the old one again.
    expect(mock.streamedPrompts.at(-1)).toBe(EDITED_PROMPT)

    await waitForStreamToFinish()

    await expect($(USER_MESSAGES)).toHaveText(
      expect.stringContaining(EDITED_PROMPT)
    )
    await expect($(ASSISTANT_MESSAGES)).toHaveText(
      expect.stringContaining(MOCK_REPLY_PREFIX + EDITED_PROMPT)
    )
  })

  it('deletes a single message without touching the rest', async () => {
    await expect($$(USER_MESSAGES)).toBeElementsArrayOfSize(1)
    await expect($$(ASSISTANT_MESSAGES)).toBeElementsArrayOfSize(1)

    // The assistant row on purpose. Its actions are always visible when not
    // streaming (MessageItem.tsx:677-682 hides the cluster only while the reply
    // is in flight), so this covers delete without also re-covering the
    // transparency workaround the edit test above already exercises.
    const assistantMessage = await $(ASSISTANT_MESSAGES)
    const deleteTrigger = await assistantMessage.$(
      '[data-testid="delete-message-trigger"]'
    )
    await deleteTrigger.waitForDisplayed({ timeout: 30_000 })
    await deleteTrigger.click()

    await $('[data-testid="delete-message-dialog"]').waitForDisplayed({
      timeout: 30_000,
    })
    await $('[data-testid="confirm-delete-message"]').click()

    // The reply goes, the prompt stays. Counting both is the point: a delete
    // that took the whole turn with it would satisfy an assertion that only
    // looked for the reply being gone.
    await browser.waitUntil(
      async () => (await $$(ASSISTANT_MESSAGES).getElements()).length === 0,
      {
        timeout: 30_000,
        timeoutMsg:
          'the assistant message is still rendered after the delete was ' +
          'confirmed.',
      }
    )
    await expect($$(USER_MESSAGES)).toBeElementsArrayOfSize(1)
  })

  it('stops a reply while it is still streaming', async () => {
    // Slow the server down for this test only. Every other test wants a reply
    // that has already finished by the time it is asserted on, and at the
    // default of 0 the whole echo lands well inside one WebDriver round trip --
    // there would be nothing left to stop by the time the click arrived.
    mock.chunkDelayMs = SLOW_CHUNK_MS
    try {
      await sendPrompt(LONG_PROMPT)

      // Wait for the reply to have *started* before stopping it, which is both
      // what the checklist item means and what makes the assertions below
      // possible.
      //
      // The stop button is already there before the first token: it is shown
      // for `submitted` as well as `streaming` (ChatInput.tsx:2019), and
      // stopping in that window leaves a partial with no content at all --
      // which $threadId.tsx:359 declines to persist, so there is no message to
      // mark `stopped`, no Continue button, and nothing to show for it. That is
      // exactly how this test failed the first time it was run.
      //
      // The *last* assistant message, and only after checking there is exactly
      // one. `$(ASSISTANT_MESSAGES)` takes the first, which is the streaming
      // reply only because the test before this one deleted the old one -- so
      // if that test failed, this would wait on a message that already reads
      // "mock reply to: ...", pass instantly, and press stop during the
      // `submitted` window the comment above warns about. The failure would
      // then be reported here, about queueing, for something that broke two
      // tests ago.
      await expect($$(ASSISTANT_MESSAGES)).toBeElementsArrayOfSize(1)
      const replies = await $$(ASSISTANT_MESSAGES).getElements()
      const reply = replies[replies.length - 1]
      await reply.waitForDisplayed({ timeout: 30_000 })
      await browser.waitUntil(
        async () => (await reply.getText()).includes(FIRST_REPLY_WORD),
        {
          timeout: 30_000,
          timeoutMsg:
            `the reply never began with "${FIRST_REPLY_WORD}", so there was no ` +
            'partial to interrupt.',
        }
      )

      // The stop button replacing the send button is the streaming state; they
      // are the two arms of one ternary (ChatInput.tsx:2917).
      const stop = await $('[data-testid="stop-message-button"]')
      await stop.waitForDisplayed({
        timeout: 30_000,
        timeoutMsg:
          'the composer never swapped in the stop button, so either the send ' +
          'did not start a stream or the stream finished before this looked. ' +
          `Each chunk is paced at ${SLOW_CHUNK_MS}ms, so the latter would mean ` +
          'the delay is not reaching the server.',
      })
      await stop.click()

      await waitForStreamToFinish(30_000)

      // Not just "the stream ended" -- that is also what finishing looks like.
      // The Continue button renders only when metadata.stopped is true
      // (MessageItem.tsx:114, :700-714), so its presence is what says the app
      // recorded a stop rather than a completion.
      await $('[data-testid="continue-message"]').waitForDisplayed({
        timeout: 30_000,
        timeoutMsg:
          'no Continue button appeared after stopping, so the reply was not ' +
          'marked as stopped. Note the stop button *clears the message queue* ' +
          'instead of stopping when anything is queued (ChatInput.tsx:2924-2939) ' +
          '-- if this spec ever sends twice without waiting, that is the cause.',
      })

      // The partial reply is kept, not discarded -- and it is genuinely
      // partial. The echo ends with the prompt, so the full text arriving would
      // mean the stream ran to completion and every assertion above was about a
      // reply that was never interrupted.
      await expect($$(ASSISTANT_MESSAGES)).toBeElementsArrayOfSize(1)
      await expect(await $(ASSISTANT_MESSAGES).getText()).not.toContain(
        LONG_PROMPT
      )
    } finally {
      mock.chunkDelayMs = 0
    }
  })

  it('starts a fresh thread from New Chat that can be chatted in at once', async () => {
    // Independent of how the stop test ended. Its `finally` puts the chunk
    // delay back, but if it failed before pressing stop the slow stream is
    // still running, and clicking New Chat mid-turn is untested behaviour that
    // would make this test's failure say nothing about New Chat.
    await waitForStreamToFinish()

    await $('[data-testid="new-chat-button"]').click()

    // New Chat navigates to `/` and creates nothing; the thread is created by
    // the first send (ChatInput.tsx:769-794). So `/` here is the whole of what
    // the button is supposed to do.
    await browser.waitUntil(
      async () => (await browser.execute(() => window.location.pathname)) === '/',
      {
        timeout: 30_000,
        timeoutMsg: 'New Chat did not navigate to `/`.',
      }
    )

    // Straight into a send, with no model picked and no provider chosen. That
    // is the checklist item: after New Chat the last used model is still
    // selected and the user can chat immediately.
    await sendPrompt(OPENING_PROMPT)

    await expect($(ASSISTANT_MESSAGES)).toHaveText(
      expect.stringContaining(MOCK_REPLY_PREFIX + OPENING_PROMPT),
      {
        message:
          'the new thread produced no reply, so New Chat did not carry the ' +
          'selected model over. Nothing was sent at all in that case: ' +
          'handleSendMessage returns early with "Please select a model to ' +
          'start chatting." when selectedModel is null (ChatInput.tsx:634-638), ' +
          'so look for that message in the composer rather than for a failed ' +
          'request in the mock log.',
      }
    )

    let newThreadId = ''
    await browser.waitUntil(
      async () => {
        const path = await browser.execute(() => window.location.pathname)
        newThreadId = path.startsWith('/threads/')
          ? path.slice('/threads/'.length)
          : ''
        return newThreadId.length > 0
      },
      { timeout: 30_000, timeoutMsg: 'the send never created a thread.' }
    )

    // A genuinely new thread, not the old one reopened -- which is what a New
    // Chat that only navigated would look like.
    expect(newThreadId).not.toBe(threadId)
    await expect($$(USER_MESSAGES)).toBeElementsArrayOfSize(1)
  })
})
