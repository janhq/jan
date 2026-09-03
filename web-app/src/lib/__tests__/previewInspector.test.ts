import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { PREVIEW_INSPECTOR_SCRIPT } from '../previewInspector'

/**
 * The inspector is an IIFE that runs inside the preview iframe's own document.
 * Vitest's jsdom document stands in for that document: evaluate the script
 * once, then drive it with synthetic pointer events.
 */
const runInspector = () => {
  const fn = new Function(PREVIEW_INSPECTOR_SCRIPT)
  fn()
  // If the document reported itself as still loading, mount waited for
  // DOMContentLoaded (which may already have fired in the test env).
  if (document.querySelectorAll('[data-jan-inspector="1"]').length < 3) {
    document.dispatchEvent(new Event('DOMContentLoaded'))
  }
}

const overlays = () =>
  [...document.querySelectorAll<HTMLDivElement>('[data-jan-inspector="1"]')]

const fire = (type: string, target: Element) => {
  const Ctor =
    typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent
  target.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true }))
}

const visible = (el: HTMLDivElement) => el.style.display === 'block'

describe('PREVIEW_INSPECTOR_SCRIPT', () => {
  beforeAll(() => {
    // jsdom has no layout engine: derive rects from inline styles so the
    // inspector's getBoundingClientRect calls produce meaningful values.
    Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
      const num = (v: string | undefined) => {
        const n = parseFloat(v ?? '')
        return Number.isFinite(n) ? n : 0
      }
      const st = this.style as CSSStyleDeclaration
      const left = num(st.left)
      const top = num(st.top)
      const width = num(st.width)
      const height = num(st.height)
      return {
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        x: left,
        y: top,
        toJSON: () => ({}),
      } as DOMRect
    }
    runInspector()
  })

  afterEach(() => {
    // Clear the pin and hover box, then drop every node the tests added while
    // keeping the inspector's own overlay divs (children of body).
    fire('pointerdown', document.body)
    for (const el of overlays()) el.style.display = 'none'
    for (const el of document.body.querySelectorAll(':not([data-jan-inspector])')) {
      el.remove()
    }
    const main = document.createElement('main')
    document.body.appendChild(main)
  })

  it('installs three overlay nodes (hover box, pin box, label)', () => {
    expect(overlays().length).toBe(3)
    for (const el of overlays()) {
      expect(el.style.pointerEvents).toBe('none')
      expect(el.style.position).toBe('fixed')
      expect(el.style.display).toBe('none')
    }
  })

  it('shows a dashed hover outline on pointerover and hides it on pointerout', () => {
    const main = document.querySelector('main')!
    main.style.width = '200px'
    main.style.height = '100px'
    const [hoverBox] = overlays()

    fire('pointerover', main)
    expect(visible(hoverBox)).toBe(true)
    // Hover uses dotted to visually distinguish from user annotations
    expect(hoverBox.style.border).toContain('dotted')
    expect(hoverBox.style.width).toBe('200px')
    expect(hoverBox.style.height).toBe('100px')

    fire('pointerout', main)
    expect(visible(hoverBox)).toBe(false)
  })

  it('ignores hover on the document background', () => {
    const [hoverBox] = overlays()
    fire('pointerover', document.body)
    expect(visible(hoverBox)).toBe(false)
  })

  it('pins a dashed bbox with a label on click', () => {
    const main = document.querySelector('main')!
    main.id = 'main'
    main.className = 'card active'
    main.style.width = '120px'
    main.style.height = '60px'
    const [, pinBox, pinLabel] = overlays()

    fire('pointerdown', main)
    expect(visible(pinBox)).toBe(true)
    // Pin uses dashed to distinguish from user annotations (which are solid)
    expect(pinBox.style.border).toContain('dashed')
    expect(pinBox.style.width).toBe('120px')
    expect(pinLabel.textContent).toBe('main#main.card.active')
  })

  it('posts the pinned bbox rect and selector to the parent', () => {
    const spy = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const main = document.querySelector('main')!
    main.style.width = '120px'
    main.style.height = '60px'

    fire('pointerdown', main)
    expect(spy).toHaveBeenCalledWith(
      {
        source: 'jan-preview-inspector',
        type: 'pin',
        label: 'main',
        rect: { x: 0, y: 0, width: 120, height: 60 },
      },
      '*'
    )
    spy.mockRestore()
  })

  it('posts clear when the pin is dismissed', () => {
    const spy = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const main = document.querySelector('main')!
    main.style.width = '80px'
    main.style.height = '40px'

    fire('pointerdown', main)
    fire('pointerdown', document.body)
    const calls = spy.mock.calls.map((c) => (c[0] as { type?: string }).type)
    expect(calls).toContain('pin')
    expect(calls).toContain('clear')
    spy.mockRestore()
  })

  it('labels svg-style elements with lowercase tags', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    svg.setAttribute('class', 'plot bar')
    svg.setAttribute('width', '10')
    svg.setAttribute('height', '10')
    document.querySelector('main')!.appendChild(svg)
    const [, , pinLabel] = overlays()

    fire('pointerdown', svg)
    expect(pinLabel.textContent).toBe('rect.plot.bar')
  })

  it('truncates very long labels', () => {
    const el = document.createElement('div')
    el.className =
      'a b c d e f g h i j k l m n o p q r s t u v w x y z 1 2 3 4 5 6 7 8 9'
    document.querySelector('main')!.appendChild(el)
    const [, , pinLabel] = overlays()

    fire('pointerdown', el)
    expect((pinLabel.textContent ?? '').length).toBe(60)
    expect(pinLabel.textContent?.endsWith('…')).toBe(true)
  })

  it('clears the pin when clicking the background', () => {
    const main = document.querySelector('main')!
    const [, pinBox, pinLabel] = overlays()

    fire('pointerdown', main)
    expect(visible(pinBox)).toBe(true)

    fire('pointerdown', document.body)
    expect(visible(pinBox)).toBe(false)
    expect(visible(pinLabel)).toBe(false)
  })

  it('clears the pin on Escape', () => {
    const main = document.querySelector('main')!
    const [, pinBox] = overlays()

    fire('pointerdown', main)
    expect(visible(pinBox)).toBe(true)

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    )
    expect(visible(pinBox)).toBe(false)
  })

  it('keeps the pin aligned after a scroll', () => {
    const main = document.querySelector('main')!
    main.style.width = '80px'
    main.style.height = '40px'
    const [, pinBox] = overlays()

    fire('pointerdown', main)
    expect(pinBox.style.left).toBe('0px')

    main.style.left = '50px'
    main.style.top = '25px'
    window.dispatchEvent(new Event('scroll'))
    expect(pinBox.style.left).toBe('50px')
    expect(pinBox.style.top).toBe('25px')
  })

  it('treats a viewport-covering wrapper as background (click clears)', () => {
    const main = document.querySelector('main')!
    const [, pinBox] = overlays()
    // jsdom default viewport is 1024x768; a wrapper covering ~all of it must
    // deselect instead of pinning the full-page container.
    main.style.width = '1100px'
    main.style.height = '800px'

    fire('pointerdown', main)
    expect(visible(pinBox)).toBe(false)
  })

  it('posts the pinned bbox rect and selector to the parent', () => {
    const spy = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const main = document.querySelector('main')!
    main.style.width = '120px'
    main.style.height = '60px'

    fire('pointerdown', main)
    expect(spy).toHaveBeenCalledWith(
      {
        source: 'jan-preview-inspector',
        type: 'pin',
        label: 'main',
        rect: { x: 0, y: 0, width: 120, height: 60 },
      },
      '*'
    )
    spy.mockRestore()
  })

  it('posts clear when the pin is dismissed', () => {
    const spy = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const main = document.querySelector('main')!
    main.style.width = '80px'
    main.style.height = '40px'

    fire('pointerdown', main)
    fire('pointerdown', document.body)
    const calls = spy.mock.calls.map((c) => (c[0] as { type?: string }).type)
    expect(calls).toContain('pin')
    expect(calls).toContain('clear')
    spy.mockRestore()
  })

  it('clears the pin when the pinned element leaves the DOM', () => {
    const main = document.querySelector('main')!
    const [, pinBox] = overlays()

    fire('pointerdown', main)
    expect(visible(pinBox)).toBe(true)

    main.remove()
    window.dispatchEvent(new Event('scroll'))
    expect(visible(pinBox)).toBe(false)
  })
})
