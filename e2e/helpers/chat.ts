import { $ } from '@wdio/globals'

import { clickWhenReady } from './interactions.js'

/**
 * Selectors and actions for the composer and the transcript.
 *
 * data-message-role is on the same node as the testid
 * (web-app/src/containers/MessageItem.tsx:558-559). System notes take an early
 * return above it and render neither attribute, so counting these counts real
 * conversation turns and nothing else.
 */
export const USER_MESSAGES =
  '[data-testid="message-item"][data-message-role="user"]'
export const ASSISTANT_MESSAGES =
  '[data-testid="message-item"][data-message-role="assistant"]'

/** The composer's send button, which is also the not-streaming signal below. */
export const SEND_BUTTON = '[data-testid="send-message-button"]'

/**
 * Put `prompt` in the composer and send it.
 *
 * Waiting for the send button is also the barrier for the *previous* turn:
 * while a response streams, ChatInput replaces it outright with a destructive
 * stop button (ChatInput.tsx:2917-2947), so it existing means no stream is in
 * flight, and it being enabled means the composer holds text.
 */
export async function sendPrompt(prompt: string) {
  const input = await $('[data-testid="chat-input"]')
  await input.waitForDisplayed({ timeout: 30_000 })
  // Typed through WDIO rather than assigned with browser.execute: the textarea
  // is React-controlled, and a direct value assignment fires no change event, so
  // `prompt` in ChatInput stays empty and the send button stays disabled.
  await input.setValue(prompt)

  await clickWhenReady(SEND_BUTTON, 60_000)
}

/**
 * Block until nothing is streaming.
 *
 * The send button and the stop button are the two arms of one ternary
 * (ChatInput.tsx:2917), so the send button coming back *is* the end of the
 * stream -- there is no separate idle state to poll, and no "is it done yet"
 * attribute to read off the message.
 */
export async function waitForStreamToFinish(timeout = 60_000) {
  await $(SEND_BUTTON).waitForExist({
    timeout,
    timeoutMsg:
      'the composer still shows a stop button, so a reply is still streaming. ' +
      'If the mock was asked for something it has no route for it answers 404 ' +
      'with the path in the body -- check the driver log before suspecting a ' +
      'hang.',
  })
}
