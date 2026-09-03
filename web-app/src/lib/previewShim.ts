/**
 * Runtime shim injected ahead of model markup in every artifact preview.
 *
 * The preview runs in an opaque-origin sandbox (`allow-scripts` without
 * `allow-same-origin`), where `localStorage`/`sessionStorage` throw a
 * SecurityError on access. Generated pages, games above all, touch storage at
 * startup for a high score or a settings blob and die before drawing a frame.
 * The shim swaps in an in-memory Storage so the page runs; nothing persists,
 * which is the right outcome for untrusted markup.
 *
 * It also reports what the sandbox otherwise swallows -- uncaught exceptions,
 * unhandled rejections, resources that fail to load and CSP-blocked fetches --
 * to the parent as `{source:'jan-preview-shim', type:'error', message}`, so the
 * pane can say why a page is blank instead of showing white.
 *
 * Dependency-free and CSP-safe (inlined under `script-src 'unsafe-inline'`).
 * Must never contain the literal `</script`.
 */
export const PREVIEW_SHIM_SCRIPT = `(function () {
  'use strict'
  if (window.__janPreviewShim) return
  window.__janPreviewShim = true

  function memoryStorage() {
    var data = {}
    var store = {
      key: function (i) {
        var keys = Object.keys(data)
        return i >= 0 && i < keys.length ? keys[i] : null
      },
      getItem: function (k) {
        return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null
      },
      setItem: function (k, v) { data[String(k)] = String(v) },
      removeItem: function (k) { delete data[String(k)] },
      clear: function () { data = {} }
    }
    Object.defineProperty(store, 'length', {
      get: function () { return Object.keys(data).length }
    })
    return store
  }

  function shimStorage(name) {
    try {
      void window[name]
      return
    } catch (e) {
      /* sandboxed: fall through to the in-memory stand-in */
    }
    try {
      Object.defineProperty(window, name, {
        value: memoryStorage(),
        configurable: true,
        writable: true
      })
    } catch (e) {
      /* not redefinable on this engine; the page keeps the throwing getter */
    }
  }
  shimStorage('localStorage')
  shimStorage('sessionStorage')

  function report(message) {
    try {
      window.parent.postMessage(
        {
          source: 'jan-preview-shim',
          type: 'error',
          message: String(message).slice(0, 500)
        },
        '*'
      )
    } catch (e) {
      /* parent gone */
    }
  }

  function describeTarget(t) {
    var tag = (t.tagName || '').toLowerCase()
    var ref = t.src || t.href || ''
    return 'Failed to load ' + tag + (ref ? ' ' + ref : '')
  }

  // Capture phase: a resource error fires on the element and does not bubble.
  window.addEventListener(
    'error',
    function (e) {
      if (e.target && e.target !== window && e.target.tagName) {
        report(describeTarget(e.target))
        return
      }
      report(e.message || 'Script error')
    },
    true
  )
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason
    report(r && r.message ? r.message : String(r))
  })
  document.addEventListener('securitypolicyviolation', function (e) {
    report('Blocked by the preview policy: ' + (e.blockedURI || e.violatedDirective))
  })
})()`

export const PREVIEW_SHIM_SOURCE = 'jan-preview-shim'

/** The error message carried by a shim report, or null for any other message. */
export function previewShimError(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const d = data as { source?: unknown; type?: unknown; message?: unknown }
  if (d.source !== PREVIEW_SHIM_SOURCE || d.type !== 'error') return null
  return typeof d.message === 'string' && d.message ? d.message : null
}
