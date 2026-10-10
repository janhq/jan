import { browser, $ } from '@wdio/globals'

import { clickWhenReady, openDialog } from './interactions.js'
import type { MockOpenAI } from './mock-openai.js'
import { goto } from './navigation.js'

/**
 * Register a mock server with the app, through the real Add Provider and Add
 * Model dialogs.
 *
 * Deliberately not by writing settings.json behind the app's back: provider
 * creation is itself on the manual QA checklist, and a hand-written file would
 * drift silently the next time the stored shape changes, turning a real
 * regression into a passing test.
 *
 * Each spec that needs a model calls this with its own name and its own server.
 * Nothing removes an earlier spec's provider, and an earlier spec's server is
 * closed in its after() -- so a second spec reaching for the first's provider
 * would be pointing at a dead port. Two providers coexisting is fine; two
 * providers advertising the same *model id* is not, because the chat dropdown
 * keys its option testid on the id alone. See MockOptions.modelId.
 */
export async function configureMockProvider(
  mock: MockOpenAI,
  providerName: string
) {
  await goto('/settings/providers')

  await openDialog(
    '[data-testid="add-provider-trigger"]',
    '[data-testid="add-provider-dialog"]'
  )

  // setValue and not addValue throughout: addValue appends, so anything that
  // retries a step leaves a field holding its value twice over.
  await $('[data-testid="provider-name-input"]').setValue(providerName)
  // Satisfies AddProviderDialog's /^https?:\/\/[^\s]+$/i check. The port is
  // whatever the mock got from binding port 0, hence reading it off the handle
  // rather than hardcoding one.
  await $('[data-testid="provider-base-url-input"]').setValue(mock.baseUrl)
  // Required by the dialog, ignored by the mock -- which is the point: this
  // suite must not need a real credential to reach a usable provider.
  await $('[data-testid="provider-api-key-input"]').setValue('e2e-not-a-real-key')
  // The API type radio is left alone on purpose: it defaults to `openai`, which
  // is the dialect the mock speaks.

  await $('[data-testid="add-provider-submit"]').click()

  // createProvider navigates on a setTimeout(..., 0)
  // (routes/settings/providers/index.tsx:42-87), so the click returns before the
  // route changes. Wait for the destination instead of assuming arrival --
  // otherwise a rejected field shows up below as a missing add-model trigger.
  await browser.waitUntil(
    async () =>
      (await browser.execute(() => window.location.pathname)) ===
      `/settings/providers/${providerName}`,
    {
      timeout: 30_000,
      timeoutMsg:
        `Add Provider never landed on /settings/providers/${providerName}. ` +
        'Either the dialog rejected a field (name, base URL and API key are ' +
        'all required, and the URL must match ^https?://\\S+$), or ' +
        'createProvider bailed out on the duplicate-name toast.',
    }
  )

  await openDialog(
    '[data-testid="add-model-trigger"]',
    '[data-testid="add-model-dialog"]'
  )

  // The typed text *is* the model id. handleInputChange (ModelCombobox.tsx:345)
  // calls onChange on every keystroke, so there is nothing to confirm with Enter
  // and add-model-submit un-disables the moment the field is non-empty.
  await $('[data-testid="model-combobox-input"]').setValue(mock.modelId)

  // Typing also opened the suggestion list, which Radix portals to
  // document.body, outside the dialog. It does sit over the submit button, but
  // that is not why this line is here: elementClick is el.click() in JS and goes
  // straight through anything painted on top, which is the whole reason
  // clickWhenReady() exists. The reason to close it is that an open combobox
  // list is a live keyboard handler -- it takes Enter, Escape and the arrow
  // keys -- so leaving it up puts a receiver for every subsequent keypress
  // between the spec and the dialog.
  //
  // One Escape closes exactly that list and nothing else, which is the least
  // obvious line in this file. The combobox's own 'Escape' case closes itself
  // and calls stopPropagation() (ModelCombobox.tsx:216-221), and AddModel.tsx's
  // onEscapeKeyDown guard preventDefault()s while isComboboxOpen, so Radix does
  // not take the same keypress as a dismiss of the dialog.
  await browser.keys('Escape')

  await clickWhenReady('[data-testid="add-model-submit"]')

  // Closing the dialog is handleSubmit's last act (AddModel.tsx), so its
  // disappearance is the signal that the model was written onto the provider
  // rather than bounced by the already-exists toast.
  await $('[data-testid="add-model-dialog"]').waitForDisplayed({
    reverse: true,
    timeout: 30_000,
  })
}

/**
 * Answer the analytics consent panel, which covers the composer's send button.
 *
 * The moment a provider completes onboarding, PromptAnalytic floats the panel at
 * `fixed bottom-4 right-4 z-50` (containers/analytics/) directly over the send
 * button. Deny rather than allow -- a test run has no business opting into
 * telemetry.
 *
 * `required` is what makes this honest. The panel appears once per profile, so
 * the spec that completes onboarding first must insist on seeing it (a silent
 * skip there would mean it is still to come, landing over whatever is being
 * clicked at the time). Every later spec in the same run must not, because the
 * answer is already recorded and waiting for it would hang for the full timeout.
 */
export async function denyAnalyticsConsent({ required }: { required: boolean }) {
  const deny = await $('[data-testid="analytic-deny"]')

  if (!required) {
    if (!(await deny.isExisting())) return
  } else {
    await deny.waitForDisplayed({
      timeout: 30_000,
      timeoutMsg:
        'the analytics consent prompt never appeared after the provider was ' +
        'configured. If it moved behind another condition, drop this step -- ' +
        'but check first that it cannot appear later and cover the composer.',
    })
  }

  await deny.click()
  await $('[data-testid="analytic-consent"]').waitForDisplayed({
    reverse: true,
    timeout: 30_000,
  })
}

/**
 * Pick a model in the chat composer's dropdown.
 *
 * Mandatory and explicit: useModelProvider defaults to
 * `{ selectedProvider: 'llamacpp', selectedModel: null }` and
 * DropdownModelProvider's init effect only ever auto-selects a llamacpp model or
 * clears the selection -- it never reaches for a custom provider. Skipping this
 * sends the turn at a model that is not there.
 */
export async function selectModel(modelId: string) {
  const trigger = await $('[data-testid="model-selector-trigger"]')
  await trigger.waitForDisplayed({
    timeout: 30_000,
    timeoutMsg:
      'the chat model selector never appeared, so hasUsableProvider() is ' +
      'false and the app is sitting on SetupScreen -- the provider and model ' +
      'from configureMockProvider() were not persisted.',
  })
  await trigger.click()

  // This testid is emitted by two sibling branches -- the favourites section and
  // the provider list (DropdownModelProvider.tsx:584 and :684) -- which cannot
  // both render the same model while the list skips favourites, and a fresh
  // profile has no favourites anyway. Both call the same handleSelect, so
  // matching either is correct.
  await clickWhenReady(`[data-testid="model-option-${modelId}"]`)
}
