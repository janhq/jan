import { browser, $ } from '@wdio/globals'

/**
 * Clicking, for a driver with no real input.
 *
 * Both helpers here started life inside specs/chat.e2e.ts. They moved once a
 * second spec needed them, which is also why the comments are long: what they
 * work around is not obvious from reading them, and the failure they prevent
 * reads as a timeout naming an element that is present, enabled and visible.
 */

/**
 * Wait for a control to be there and usable, then click it.
 *
 * Deliberately not waitForClickable(). WDIO's clickability check includes an
 * elementFromPoint test, and this driver's click does not: elementClick is
 * `el.scrollIntoView(); el.click(); el.focus()` in JS
 * (tauri-plugin-wdio-webdriver, src/platform/executor.rs), which sails through
 * anything painted on top. So the precheck can only ever reject clicks that
 * would have worked, and on a first launch there is plenty painted on top --
 * the analytics consent panel floats over the composer, and an unseeded profile
 * toasts "Download Complete" over the header. Neither stops the click, but
 * either turns this into a 30s timeout naming an element that is fine.
 *
 * Displayed and enabled are still worth waiting for: those are real states this
 * app puts its controls in (Add Model stays disabled until the id field has
 * something in it, and the send button is swapped out entirely while a reply
 * streams).
 *
 * Note that `opacity: 0` is NOT one of the differences -- waitForDisplayed()
 * runs checkVisibility({opacityProperty: true}) browser-side and rejects a
 * transparent element just as waitForClickable() would. Anything revealed only
 * on hover or focus needs waitForExist() and a click to focus it instead; see
 * the thread overflow menu in specs/chat.e2e.ts.
 */
export async function clickWhenReady(selector: string, timeout = 30_000) {
  const element = await $(selector)
  await element.waitForDisplayed({ timeout })
  await element.waitForEnabled({ timeout })
  await element.click()
  return element
}

/**
 * What one attempt at opening a dialog did, for the timeout message below.
 *
 * `already-open` is the interesting one: it means the trigger says the dialog
 * is open while the dialog is not displayed, which is a different bug from the
 * click never landing and used to be indistinguishable from it.
 */
type OpenAttempt =
  | 'clicked'
  | 'already-open'
  | 'missing'
  | 'disabled'
  | 'hidden'

/**
 * Click a dialog's trigger until the dialog is actually up.
 *
 * One click has been seen not to take. Twice now: once on an unloaded machine
 * in the window where the embedder-download toast was landing, and once as a
 * run of three consecutive red runs that went green again on their own. Both
 * times the trigger was present and enabled and the dialog never appeared.
 *
 * **Why the code below is shaped this way, and what that does not claim.** The
 * standing hypothesis is `el.click()` reaching a node React had already
 * replaced: WDIO resolves `$(selector)` to an element id and spends a round
 * trip per call against it, so a check-then-click sequence leaves a window --
 * four round trips wide -- in which the node can be torn out, and this driver
 * synthesizes clicks in JavaScript, so a click at a detached node is silent
 * rather than an error. Doing the query and the click together in one
 * `browser.execute` closes that window, and is the same operation rather than a
 * workaround: `click_element` in this driver *is*
 * `el.scrollIntoView(); el.click(); el.focus()` evaluated in the page
 * (tauri-plugin-wdio-webdriver, src/platform/executor.rs). It also costs one
 * round trip instead of five.
 *
 * But the hypothesis is untested. An attempt to reproduce the failure by
 * saturating every core produced 4/4 green runs with this version *and* 4/4
 * with the check-then-click version it replaced, so synthetic CPU load is not
 * the trigger and this change is **not demonstrated to fix anything**. It is
 * kept because a narrower window and one round trip are strictly better, not
 * because the flake is understood.
 *
 * The part that will actually help is the timeout message: it now reports what
 * the last attempt observed, so the next failure -- on CI, on a runner nobody
 * can attach to -- says whether the click landed on a live node, whether the
 * trigger thought the dialog was already open, or whether the selector matched
 * nothing at all. Those are three different faults that until now produced one
 * indistinguishable message.
 *
 * The retry stays, and its guard is the one verified part: Radix mirrors open
 * state onto the trigger as `data-state` and its onClick is a **toggle**, so
 * clicking one that already reads "open" would shut a dialog that had in fact
 * opened.
 */
export async function openDialog(
  triggerSelector: string,
  dialogSelector: string
) {
  // Kept across iterations so the timeout can say what it kept seeing rather
  // than assert something about the trigger it never checked.
  let lastAttempt: OpenAttempt = 'missing'

  await browser.waitUntil(
    async () => {
      if (await $(dialogSelector).isDisplayed()) return true

      lastAttempt = await browser.execute((selector: string) => {
        const el = document.querySelector(selector) as HTMLElement | null
        if (!el) return 'missing'
        if ((el as HTMLButtonElement).disabled) return 'disabled'
        const style = window.getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden') {
          return 'hidden'
        }
        // Radix's trigger toggles, so a second click on an open one shuts it.
        if (el.getAttribute('data-state') === 'open') return 'already-open'
        el.scrollIntoView()
        el.click()
        el.focus()
        return 'clicked'
      }, triggerSelector)

      return false
    },
    {
      timeout: 30_000,
      interval: 1_000,
      timeoutMsg:
        `clicking ${triggerSelector} never brought up ${dialogSelector}. ` +
        `The last attempt reported "${lastAttempt}": ` +
        '"clicked" means the click landed on a live node and the dialog still ' +
        'did not open; "already-open" means the trigger believes it is open ' +
        'while the dialog is not displayed, which is a different fault; ' +
        '"missing" means the selector matched nothing, so the page had not ' +
        'rendered or the testid changed.',
    }
  )
}
