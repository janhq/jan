/**
 * Element-inspector script injected into artifact preview iframes (Cursor
 * browser / Claude artifacts style). Runs inside the sandboxed srcdoc document
 * itself, so it can inspect the DOM even though the opaque origin makes the
 * parent page unable to reach it.
 *
 * Behavior:
 * - Hover: thin dashed outline + (on click) a pinned solid bounding box and a
 *   label chip (`div#main.card.active`, truncated) following the element.
 * - Click an element: pin its bbox + label. Click the background (html/body)
 *   or press Escape: clear the pin. Scrolling/resizing keeps the pin aligned.
 * - Every pin/clear posts a `{source:'jan-preview-inspector', type:'pin'|
 *   'clear'}` message to the parent so the annotation overlay can anchor its
 *   inline note box at the selected element (see AnnotationOverlay).
 *
 * Kept dependency-free and CSP-safe: inlined via `script-src 'unsafe-inline'`,
 * only DOM/style APIs, no network. The string must never contain the literal
 * `</script` (it would terminate the inline tag early), hence concatenation
 * style and no HTML in here.
 */
export const PREVIEW_INSPECTOR_SCRIPT = `(function () {
  'use strict'
  if (window.__janPreviewInspector) return
  window.__janPreviewInspector = true

  var HOVER = '#94a3b8'  // slate-400 - subtle gray for hover
  var PIN = '#64748b'    // slate-500 - darker gray for pinned
  var hoverBox = null
  var pinBox = null
  var pinLabel = null
  var pinnedEl = null

  function makeBox() {
    var el = document.createElement('div')
    el.setAttribute('data-jan-inspector', '1')
    el.style.cssText =
      'position:fixed;pointer-events:none;z-index:2147483647;display:none;' +
      'box-sizing:border-box;margin:0;padding:0'
    return el
  }

  function makeLabel() {
    var el = document.createElement('div')
    el.setAttribute('data-jan-inspector', '1')
    el.style.cssText =
      'position:fixed;pointer-events:none;z-index:2147483647;display:none;' +
      'max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
      'padding:1px 6px;border-radius:3px;' +
      'font:11px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'color:#fff;background:' + HOVER
    return el
  }

  function labelFor(el) {
    var out = (el.tagName || 'div').toLowerCase()
    if (el.id) out += '#' + el.id
    if (el.classList && el.classList.length) {
      var cls = []
      for (var i = 0; i < el.classList.length; i++) cls.push(el.classList[i])
      out += '.' + cls.join('.')
    }
    return out.length > 60 ? out.slice(0, 59) + '…' : out
  }

  function placeBox(box, el, color, width, dashed) {
    var r = el.getBoundingClientRect()
    // Inspector uses dots for hover, short dashes for pin - clearly different
    // from user annotations which use solid lines or long dashes (6px dash, 4px gap).
    var dashStyle = dashed ? '1px dotted' : '2px dashed'
    box.style.border = dashStyle + ' ' + color
    box.style.left = r.left + 'px'
    box.style.top = r.top + 'px'
    box.style.width = r.width + 'px'
    box.style.height = r.height + 'px'
    box.style.display = 'block'
    return r
  }

  function placeLabel(r) {
    var top = r.top - 22
    if (top < 2) top = r.bottom + 4
    pinLabel.style.left = r.left + 'px'
    pinLabel.style.top = top + 'px'
    pinLabel.style.display = 'block'
  }

  function isBackground(t) {
    return !t || t === document.documentElement || t === document.body
  }

  // The parent (annotation overlay) anchors its inline note box at the pinned
  // element, so it needs the bbox. postMessage works across the sandbox; the
  // opaque origin forces targetOrigin '*'.
  function sendPin(r, label) {
    try {
      window.parent.postMessage(
        {
          source: 'jan-preview-inspector',
          type: 'pin',
          label: label,
          rect: { x: r.left, y: r.top, width: r.width, height: r.height }
        },
        '*'
      )
    } catch (e) {
      /* parent may be gone or block cross-frame messaging */
    }
  }

  function sendClear() {
    try {
      window.parent.postMessage(
        { source: 'jan-preview-inspector', type: 'clear' },
        '*'
      )
    } catch (e) {
      /* see sendPin */
    }
  }

  // Clicking whitespace should deselect, not pin the full-page wrapper that
  // usually covers the whole viewport.
  function coversViewport(el) {
    var r = el.getBoundingClientRect()
    return (
      r.width >= window.innerWidth * 0.98 &&
      r.height >= window.innerHeight * 0.98
    )
  }

  function clearPin() {
    pinnedEl = null
    if (pinBox) pinBox.style.display = 'none'
    if (pinLabel) pinLabel.style.display = 'none'
    sendClear()
  }

  function refreshPin() {
    if (!pinnedEl) return
    if (!pinnedEl.isConnected) {
      clearPin()
      return
    }
    var r = placeBox(pinBox, pinnedEl, PIN, 2, false)
    placeLabel(r)
    // Re-post so the parent's pin chip tracks the element while the page
    // scrolls or resizes; the overlay dedupes an unchanged rect.
    sendPin(r, pinLabel.textContent)
  }

  document.addEventListener(
    'pointerover',
    function (e) {
      if (!hoverBox) return
      var t = e.target
      if (
        !t ||
        t.nodeType !== 1 ||
        isBackground(t) ||
        coversViewport(t) ||
        t === pinnedEl
      ) {
        hoverBox.style.display = 'none'
        return
      }
      placeBox(hoverBox, t, HOVER, 1, true)
    },
    true
  )

  document.addEventListener(
    'pointerout',
    function () {
      if (hoverBox) hoverBox.style.display = 'none'
    },
    true
  )

  document.addEventListener(
    'pointerdown',
    function (e) {
      var t = e.target
      if (!t || t.nodeType !== 1 || isBackground(t) || coversViewport(t)) {
        clearPin()
        return
      }
      pinnedEl = t
      pinLabel.textContent = labelFor(t)
      var r = placeBox(pinBox, t, PIN, 2, false)
      placeLabel(r)
      sendPin(r, pinLabel.textContent)
    },
    true
  )

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') clearPin()
  })

  // The annotation overlay drops the pin when it leaves the select tool, so a
  // stale bbox never sits underneath the strokes the user is drawing.
  window.addEventListener('message', function (e) {
    var d = e.data
    if (d && d.source === 'jan-annotation-overlay' && d.type === 'clear') {
      clearPin()
      // The hover outline sticks too: once the overlay captures the pointer,
      // this frame never sees the pointerout that would have hidden it.
      if (hoverBox) hoverBox.style.display = 'none'
    }
  })

  window.addEventListener('scroll', refreshPin, true)
  window.addEventListener('resize', refreshPin)

  function mount() {
    hoverBox = makeBox()
    pinBox = makeBox()
    pinLabel = makeLabel()
    document.body.appendChild(hoverBox)
    document.body.appendChild(pinBox)
    document.body.appendChild(pinLabel)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount)
  } else {
    mount()
  }
})()`
