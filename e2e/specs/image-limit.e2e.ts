import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { browser, expect, $, $$ } from '@wdio/globals'

import {
  ASSISTANT_MESSAGES,
  sendPrompt,
  waitForStreamToFinish,
} from '../helpers/chat.js'
import { clickWhenReady } from '../helpers/interactions.js'
import {
  MOCK_REPLY_PREFIX,
  startMockOpenAI,
  type MockOpenAI,
} from '../helpers/mock-openai.js'
import { goto, waitForPath } from '../helpers/navigation.js'
import { janUserDataDir } from '../helpers/paths.js'
import {
  configureMockProvider,
  denyAnalyticsConsent,
  selectModel,
} from '../helpers/provider.js'

// The worker inherits this from the launcher; see wdio.conf.ts.
const testHome = process.env.JAN_E2E_HOME!

// Own provider and own model id: see the same note in message-actions.e2e.ts.
const PROVIDER_NAME = 'e2e-image-limit-provider'
const MODEL_ID = 'jan-e2e-image-limit'

// Titles come from web-app/src/locales/en/settings.json
// (settings:attachments.maxImage / maxFile). The settings rows carry no testid,
// so the row is found by its heading: h1 -> description wrapper -> row.
const IMAGE_ROW_INPUT =
  '//h1[normalize-space(.)="Max Image Size (MB)"]/../..//input'
const ATTACHMENTS_TOGGLE =
  '//h1[normalize-space(.)="Enable Attachments"]/../..//*[@role="switch"]'
const DOC_ROW_INPUT =
  '//h1[normalize-space(.)="Max Document Size (MB)"]/../..//input'

// Persisted key of useImageAttachmentConfig (constants/localStorage.ts). The
// zustand persist blob lands in the backend settings store, a flat string map
// at <jan_data>/settings.json, as a JSON string.
const IMAGE_SETTING_KEY = 'setting-image-attachments'

// Sizes. The PNGs are built in the page, so no fixture is committed.
//   700x750 RGB, stored deflate  -> ~1.50 MiB   (over a 1MB limit, under 2MB)
//   740x1150 RGB, stored deflate -> ~2.43 MiB   (over a 2MB limit)
//   57x58 RGB                    -> ~9.9 KB     (under everything)
const BIG = { width: 700, height: 750 }
const HUGE = { width: 740, height: 1150 }
const SMALL = { width: 57, height: 58 }

/**
 * Browser-side helpers, installed once on `window.__e2e` as a plain string.
 *
 * A string rather than a function passed to browser.execute(): tsx compiles
 * with keepNames, which wraps named functions in a `__name()` call that does
 * not exist in the webview, so a function with inner helpers would die with
 * "__name is not defined".
 *
 * make()    builds a valid PNG with *stored* (uncompressed) deflate blocks and a
 *           seeded LCG for pixels, so the bytes are deterministic and the file
 *           is as large as asked regardless of the compressor.
 * paste()   dispatches a ClipboardEvent('paste') on the composer carrying a
 *           DataTransfer that holds the File (ChatInput.handlePaste).
 * drop()    dispatches a DragEvent('drop') carrying the File on the composer's
 *           drop zone (ChatInput.handleDrop).
 * input()   puts the File on the hidden image <input type=file> and fires
 *           `change` (ChatInput.handleFileChange). Needs the "+" menu open,
 *           because the input is rendered inside the menu content.
 */
const PAGE_HELPERS = `
(function () {
  var files = {};
  var table = [];
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  function crc(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function u32(v) { return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]; }
  function chunk(type, data) {
    var body = new Uint8Array(4 + data.length);
    for (var i = 0; i < 4; i++) body[i] = type.charCodeAt(i);
    body.set(data, 4);
    var out = new Uint8Array(12 + data.length);
    out.set(u32(data.length), 0);
    out.set(body, 4);
    out.set(u32(crc(body)), 8 + data.length);
    return out;
  }
  function makePng(w, h, seed) {
    var stride = w * 3 + 1;
    var raw = new Uint8Array(stride * h);
    var s = seed >>> 0;
    for (var y = 0; y < h; y++) {
      for (var x = 1; x < stride; x++) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        raw[y * stride + x] = s >>> 24;
      }
    }
    var a = 1, b = 0;
    for (var i = 0; i < raw.length; i++) { a = (a + raw[i]) % 65521; b = (b + a) % 65521; }
    var blocks = Math.ceil(raw.length / 65535);
    var z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
    var p = 0;
    z[p++] = 0x78; z[p++] = 0x01;
    for (var off = 0; off < raw.length; off += 65535) {
      var len = Math.min(65535, raw.length - off);
      z[p++] = off + len >= raw.length ? 1 : 0;
      z[p++] = len & 255; z[p++] = len >>> 8;
      z[p++] = ~len & 255; z[p++] = (~len >>> 8) & 255;
      z.set(raw.subarray(off, off + len), p);
      p += len;
    }
    z.set(u32(((b << 16) | a) >>> 0), p);
    var ihdr = new Uint8Array(13);
    ihdr.set(u32(w), 0); ihdr.set(u32(h), 4);
    ihdr[8] = 8; ihdr[9] = 2;
    var parts = [
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))
    ];
    return new Blob(parts, { type: 'image/png' });
  }
  function dataTransferFor(name) {
    var dt = new DataTransfer();
    dt.items.add(files[name]);
    return dt;
  }
  window.__e2e = {
    make: async function (name, w, h, seed) {
      files[name] = new File([makePng(w, h, seed)], name, { type: 'image/png' });
      var url = URL.createObjectURL(files[name]);
      try {
        var image = new Image();
        image.src = url;
        await image.decode();
        if (image.naturalWidth !== w || image.naturalHeight !== h) throw new Error('PNG dimensions differ');
      } finally { URL.revokeObjectURL(url); }
      return files[name].size;
    },
    paste: function (name) {
      var dt = dataTransferFor(name);
      var ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      var seen = ev.clipboardData ? ev.clipboardData.items.length : -1;
      document.querySelector('[data-testid="chat-input"]').dispatchEvent(ev);
      return { itemsOnEvent: seen, defaultPrevented: ev.defaultPrevented };
    },
    drop: function (name) {
      var zone = document.querySelector('[data-drop-zone="true"]');
      if (!zone) return { zone: false, defaultPrevented: false };
      var ev = new DragEvent('drop', { dataTransfer: dataTransferFor(name), bubbles: true, cancelable: true });
      zone.dispatchEvent(ev);
      return { zone: true, defaultPrevented: ev.defaultPrevented };
    },
    input: function (name) {
      var el = document.querySelector('input[type="file"]:not([accept])');
      if (!el) return { found: false, assigned: 0 };
      el.files = dataTransferFor(name).files;
      var assigned = el.files.length;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { found: true, assigned: assigned };
    }
  };
})();
`

/** Build a PNG in the page and keep it there under `name`; returns its size. */
async function makeImage(
  name: string,
  dims: { width: number; height: number },
  seed: number
): Promise<number> {
  return browser.execute(
    (n: string, w: number, h: number, s: number) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__e2e.make(n, w, h, s) as number,
    name,
    dims.width,
    dims.height,
    seed
  )
}

async function pasteImage(name: string) {
  const result = await browser.execute(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (n: string) => (window as any).__e2e.paste(n),
    name
  )
  // Both facts matter: the event really carried the file, and ChatInput's
  // handler claimed it (it preventDefault()s synchronously for image items).
  expect(result.itemsOnEvent).toBe(1)
  expect(result.defaultPrevented).toBe(true)
}

async function dropImage(name: string) {
  const result = await browser.execute(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (n: string) => (window as any).__e2e.drop(n),
    name
  )
  // data-drop-zone is only rendered while the selected model can take images.
  expect(result.zone).toBe(true)
  expect(result.defaultPrevented).toBe(true)
}

/**
 * Open the composer's "+" menu and wait for "Add Images".
 *
 * Radix's trigger opens on pointerdown, which this driver never produces, so it
 * is the click-to-focus + Enter route used for the thread menu in chat.e2e.ts.
 * "Add Images" is only rendered for a vision model, so seeing it is also proof
 * the capability flag took.
 */
async function openPlusMenu() {
  const plus = await $('//button[.//*[contains(@class,"lucide-plus")]]')
  await plus.waitForExist({ timeout: 30_000 })
  await plus.click()
  await browser.keys('Enter')
  await $('//*[@role="menuitem"][contains(., "Add Images")]').waitForDisplayed({
    timeout: 15_000,
    timeoutMsg:
      'the "+" menu never showed "Add Images": either the menu did not open or ' +
      'the model has no vision capability.',
  })
}

async function inputImage(name: string) {
  await openPlusMenu()
  const result = await browser.execute(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (n: string) => (window as any).__e2e.input(n),
    name
  )
  expect(result).toEqual({ found: true, assigned: 1 })
  // Close the menu so it cannot sit between the spec and the composer.
  await browser.keys('Escape')
}

const errorBanner = (needle: string) =>
  `//*[contains(@class,"text-destructive")][contains(., "${needle}")]`
const chip = (name: string) => `img[alt="${name}"]`

/** Type into a settings number input and wait for the 500ms debounce to land. */
async function setLimitViaUi(inputXpath: string, value: number) {
  const input = await $(inputXpath)
  await input.waitForDisplayed({ timeout: 30_000 })
  await input.setValue(String(value))
  // The debounce commits to the store, which persists to settings.json: that
  // file is the settle signal, not a fixed sleep.
  await browser.waitUntil(() => persistedImageLimit() === value, {
    timeout: 15_000,
    timeoutMsg: `settings.json never recorded maxImageSizeMB=${value}`,
  })
  await browser.waitUntil(
    async () => (await input.getValue()) === String(value),
    {
      timeout: 10_000,
      timeoutMsg: `the input does not read ${value} after the debounce`,
    }
  )
}

function persistedImageLimit(): number | undefined {
  try {
    const file = join(janUserDataDir(testHome), 'settings.json')
    const store = JSON.parse(readFileSync(file, 'utf8')) as Record<
      string,
      string
    >
    const blob = store[IMAGE_SETTING_KEY]
    return blob ? JSON.parse(blob).state?.maxImageSizeMB : undefined
  } catch {
    return undefined
  }
}

async function openAttachmentsSettings(viaMenu: boolean) {
  if (viaMenu) {
    await clickWhenReady('a[href="/settings/attachments"]')
    await waitForPath('/settings/attachments')
  } else {
    await goto('/settings/attachments')
  }
  await $(IMAGE_ROW_INPUT).waitForDisplayed({ timeout: 30_000 })
  await $(DOC_ROW_INPUT).waitForDisplayed({ timeout: 30_000 })
}

describe('image size limit', () => {
  let mock: MockOpenAI
  let bigSize = 0

  before(async () => {
    mock = await startMockOpenAI({ modelId: MODEL_ID })

    await $('#root').waitForExist({ timeout: 60_000 })

    await configureMockProvider(mock, PROVIDER_NAME)
    await denyAnalyticsConsent({ required: false })

    // A model added by hand only gets `completion`, and every image intake path
    // in ChatInput is gated on the `vision` capability (hasMmproj). Turn it on
    // the way a user would: the pencil on the model row -> Vision -> Save. The
    // pencil has no testid, so it is found by its icon class; the switch has a
    // stable id.
    const pencil = await $(
      '//*[local-name()="svg" and contains(@class,"tabler-icon-pencil")]/..'
    )
    await pencil.waitForDisplayed({ timeout: 30_000 })
    await pencil.click()
    await clickWhenReady('#vision-capability')
    await expect($('#vision-capability')).toHaveAttribute(
      'data-state',
      'checked'
    )
    await clickWhenReady('//button[normalize-space(.)="Save Changes"]')
    await $('#vision-capability').waitForDisplayed({
      reverse: true,
      timeout: 15_000,
    })

    await browser.execute(PAGE_HELPERS)
  })

  after(async () => {
    try {
      // Restore the UI toggle after keeping documents off throughout intake.
      await openAttachmentsSettings(false)
      const toggle = await $(ATTACHMENTS_TOGGLE)
      if ((await toggle.getAttribute('data-state')) === 'unchecked')
        await toggle.click()
      await expect(toggle).toHaveAttribute('data-state', 'checked')
    } finally {
      if (mock) await mock.close()
    }
  })

  it('shows the defaults: 10MB images, 100MB documents, both in the Limits card', async () => {
    // From the provider page the settings menu is on screen, so this one goes
    // through the real navigation link.
    await openAttachmentsSettings(true)
    // RAG extension settings use webview localStorage, which can survive app
    // launches on macOS even when the backend profile is new. Establish the
    // toggle through the UI rather than assuming the previous run left it on.
    const toggle = await $(ATTACHMENTS_TOGGLE)
    if ((await toggle.getAttribute('data-state')) !== 'checked')
      await toggle.click()
    await expect(toggle).toHaveAttribute('data-state', 'checked')

    await expect($(IMAGE_ROW_INPUT)).toHaveValue('10')
    await expect($(DOC_ROW_INPUT)).toHaveValue('100')

    // Both limits share the Limits card, with images first.
    const rowsInLimitsCard = await browser.execute(() => {
      const card = Array.from(document.querySelectorAll('h1')).find(
        (h) => h.textContent?.trim() === 'Limits'
      )?.parentElement
      if (!card) return []
      return Array.from(card.querySelectorAll('h1'))
        .map((h) => h.textContent?.trim() ?? '')
        .filter((text) => text !== 'Limits')
    })
    expect(rowsInLimitsCard).toEqual([
      'Max Image Size (MB)',
      'Max Document Size (MB)',
    ])
  })

  it('disables only the document limit when Enable Attachments is off', async () => {
    const toggle = await $(ATTACHMENTS_TOGGLE)
    await expect(toggle).toHaveAttribute('data-state', 'checked')
    await expect(
      $(DOC_ROW_INPUT + '/ancestor::*[@aria-disabled="true"]')
    ).not.toBeExisting()
    await toggle.click()
    await expect(toggle).toHaveAttribute('data-state', 'unchecked')
    // disabledReason wraps the control; it does not set input.disabled.
    const disabledDocument = $(
      DOC_ROW_INPUT + '/ancestor::*[@aria-disabled="true"]'
    )
    await expect(disabledDocument).toHaveAttribute(
      'title',
      'Turn on Enable Attachments to change the document size limit.'
    )
    expect(
      (await disabledDocument.getCSSProperty('pointer-events')).value
    ).toBe('none')
    expect((await disabledDocument.getCSSProperty('opacity')).value).toBe(0.5)
    await expect(
      $(IMAGE_ROW_INPUT + '/ancestor::*[@aria-disabled="true"]')
    ).not.toBeExisting()
    await expect($(IMAGE_ROW_INPUT)).toBeEnabled()
    await expect($(DOC_ROW_INPUT + '/ancestor::*[@inert]/..')).toHaveAttribute(
      'title',
      'Turn on Enable Attachments to change the document size limit.'
    )
    await expect($(IMAGE_ROW_INPUT + '/ancestor::*[@inert]')).not.toBeExisting()
    const focus = await browser.execute(() => {
      const headings = Array.from(document.querySelectorAll('h1'))
      const documentInput = headings
        .find((h) => h.textContent?.trim() === 'Max Document Size (MB)')
        ?.parentElement?.parentElement?.querySelector('input')
      const imageInput = headings
        .find((h) => h.textContent?.trim() === 'Max Image Size (MB)')
        ?.parentElement?.parentElement?.querySelector('input')
      imageInput?.focus()
      const imageFocused = document.activeElement === imageInput
      documentInput?.focus()
      return {
        imageFocused,
        documentFocused: document.activeElement === documentInput,
      }
    })
    expect(focus).toEqual({ imageFocused: true, documentFocused: false })
    // Leave documents off: subsequent accepted images prove independence.
  })

  it('saves an image limit edit when navigating away before the debounce', async () => {
    // Dispatch the input and navigation in one webview task: the 500ms timer
    // cannot fire between them, regardless of WebDriver round-trip latency.
    await browser.execute(() => {
      const heading = Array.from(document.querySelectorAll('h1')).find(
        (h) => h.textContent?.trim() === 'Max Image Size (MB)'
      )
      const input =
        heading?.parentElement?.parentElement?.querySelector('input')
      const link = document.querySelector<HTMLAnchorElement>(
        'a[href="/settings/general"]'
      )
      if (!input || !link)
        throw new Error('Missing image limit or settings navigation')
      // React tracks direct assignments; use the native setter and an input
      // event to deliver the same change as typing, then the real UI link.
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )!.set!
      setter.call(input, '2')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      link.click()
    })
    await waitForPath('/settings/general')
    await browser.waitUntil(() => persistedImageLimit() === 2, {
      timeout: 15_000,
      timeoutMsg: 'leaving Settings before 500ms lost the pending image limit',
    })
    await openAttachmentsSettings(true)
    await expect($(IMAGE_ROW_INPUT)).toHaveValue('2')
    await expect($(DOC_ROW_INPUT)).toHaveValue('100')
  })

  it('persists a new image limit of 1MB set through the input', async () => {
    await setLimitViaUi(IMAGE_ROW_INPUT, 1)
    // Setting the image limit must not move the document limit.
    await expect($(DOC_ROW_INPUT)).toHaveValue('100')
  })

  it('rejects a 1.5MB image on paste, drop and the file input, with no chip', async () => {
    bigSize = await makeImage('oversized-paste.png', BIG, 1)
    await makeImage('oversized-drop.png', BIG, 1)
    await makeImage('oversized-input.png', BIG, 1)
    // Over 1MiB and under 2MiB, which is what the next steps lean on.
    expect(bigSize).toBeGreaterThan(1024 * 1024)
    expect(bigSize).toBeLessThan(2 * 1024 * 1024)

    await goto('/')
    await selectModel(MODEL_ID)

    for (const [deliver, name] of [
      [pasteImage, 'oversized-paste.png'],
      [dropImage, 'oversized-drop.png'],
      [inputImage, 'oversized-input.png'],
    ] as const) {
      await deliver(name)
      // Names differ per path, so each message is that path's own. The message
      // is set after validation and the chip would be added before it, so
      // waiting for the message first makes the "no chip" check below mean
      // something.
      await $(
        errorBanner(`File too large (max 1MB): ${name}`)
      ).waitForDisplayed({
        timeout: 30_000,
        timeoutMsg: `no "too large (max 1MB)" error for ${name}`,
      })
      await expect($(chip(name))).not.toBeExisting()
    }
    await expect($$('img[alt$=".png"]')).toBeElementsArrayOfSize(0)
  })

  it('accepts a 10KB image and sends it as exactly one base64 image part', async () => {
    const size = await makeImage('small-paste.png', SMALL, 2)
    expect(size).toBeGreaterThan(9 * 1024)
    expect(size).toBeLessThan(11 * 1024)

    await pasteImage('small-paste.png')
    await $(chip('small-paste.png')).waitForDisplayed({ timeout: 30_000 })
    // Accepting an image clears the previous rejection.
    await expect($(errorBanner('too large'))).not.toBeExisting()

    const before = mock.streamedUserParts.length
    await sendPrompt('describe the small picture')
    await expect($(ASSISTANT_MESSAGES)).toHaveText(
      expect.stringContaining(MOCK_REPLY_PREFIX + 'describe the small picture')
    )
    await waitForStreamToFinish()

    expect(mock.streamedUserParts.length).toBe(before + 1)
    const parts = mock.streamedUserParts[before]
    expect(parts.imageParts).toHaveLength(1)
    expect(parts.imageParts[0].isDataImageUrl).toBe(true)
    expect(parts.partTypes).toEqual(['text', 'image_url'])
    expect(parts.imageParts[0].decodedBytes).toBe(size)
    expect(parts.imageParts[0].isValidPngDataUrl).toBe(true)
    // ~10KB of PNG is ~13KB of base64: it is the image, not a stub.
    expect(parts.imageParts[0].urlLength).toBeGreaterThan(10_000)
  })

  it('accepts small images through drop and the file input as well', async () => {
    await makeImage('small-drop.png', SMALL, 3)
    await makeImage('small-input.png', SMALL, 4)

    await dropImage('small-drop.png')
    await $(chip('small-drop.png')).waitForDisplayed({ timeout: 30_000 })
    await inputImage('small-input.png')
    await $(chip('small-input.png')).waitForDisplayed({ timeout: 30_000 })

    const before = mock.streamedUserParts.length
    await sendPrompt('describe both pictures')
    await waitForStreamToFinish()
    await browser.waitUntil(
      () => mock.streamedUserParts.length === before + 1,
      {
        timeout: 30_000,
        timeoutMsg: 'the mock never saw the second image turn',
      }
    )
    const parts = mock.streamedUserParts[before]
    expect(parts.imageParts).toHaveLength(2)
    for (const image of parts.imageParts) {
      expect(image.isDataImageUrl).toBe(true)
      expect(image.hasBase64Marker).toBe(true)
    }
  })

  it('accepts the 1.5MB image once the limit is raised to 2MB', async () => {
    await openAttachmentsSettings(false)
    await setLimitViaUi(IMAGE_ROW_INPUT, 2)
    await expect($(DOC_ROW_INPUT)).toHaveValue('100')

    await goto('/')
    await selectModel(MODEL_ID)

    await makeImage('big-accepted.png', BIG, 1)
    await pasteImage('big-accepted.png')
    await $(chip('big-accepted.png')).waitForDisplayed({ timeout: 30_000 })
    await expect($(errorBanner('too large'))).not.toBeExisting()

    const before = mock.streamedUserParts.length
    await sendPrompt('describe the big picture')
    await waitForStreamToFinish()
    await browser.waitUntil(
      () => mock.streamedUserParts.length === before + 1,
      {
        timeout: 60_000,
        timeoutMsg: 'the mock never saw the big image turn',
      }
    )
    const parts = mock.streamedUserParts[before]
    expect(parts.imageParts).toHaveLength(1)
    expect(parts.imageParts[0].isDataImageUrl).toBe(true)
    expect(parts.imageParts[0].hasBase64Marker).toBe(true)
    // 1.5MiB of PNG is >2MB of base64 text: the whole image went out.
    expect(parts.imageParts[0].urlLength).toBeGreaterThan(1.5 * 1024 * 1024)
  })

  it('names the new limit when a 2.4MB image is rejected', async () => {
    await goto('/')
    await selectModel(MODEL_ID)

    const size = await makeImage('huge-paste.png', HUGE, 5)
    expect(size).toBeGreaterThan(2 * 1024 * 1024)

    await pasteImage('huge-paste.png')
    await $(
      errorBanner('too large (max 2MB): huge-paste.png')
    ).waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: 'the rejection did not report the raised 2MB limit',
    })
    await expect($(chip('huge-paste.png'))).not.toBeExisting()
  })

  it('keeps the image limit across a webview reload, and the document limit unchanged', async () => {
    // Same reload recipe as chat.e2e.ts: from `/`, never from a deep path.
    await goto('/')
    await browser.refresh()
    await $('#root').waitForExist({ timeout: 60_000 })
    await $('[data-testid="model-selector-trigger"]').waitForDisplayed({
      timeout: 60_000,
    })

    await openAttachmentsSettings(false)

    // The store starts at the default and rehydrates asynchronously from the
    // backend, so wait for the value rather than reading it once. A limit that
    // did not persist would settle on 10 and fail here.
    const image = await $(IMAGE_ROW_INPUT)
    await browser.waitUntil(async () => (await image.getValue()) === '2', {
      timeout: 15_000,
      timeoutMsg: 'after a reload Max Image Size did not come back as 2',
    })
    await expect($(DOC_ROW_INPUT)).toHaveValue('100')
    expect(persistedImageLimit()).toBe(2)
  })
})
