!(function () {
  'use strict'
  !(function (t) {
    var e = t.screen,
      n = e.width,
      r = e.height,
      a = t.navigator.language,
      i = t.location,
      o = t.localStorage,
      u = t.document,
      c = t.history,
      f = 'jan.ai',
      s = 'mainpage',
      l = i.search,
      d = u.currentScript
    if (d) {
      var m = 'data-',
        h = d.getAttribute.bind(d),
        v = h(m + 'website-id'),
        p = h(m + 'host-url'),
        g = 'false' !== h(m + 'auto-track'),
        y = h(m + 'do-not-track'),
        b = h(m + 'domains') || '',
        S = b.split(',').map(function (t) {
          return t.trim()
        }),
        k =
          (p ? p.replace(/\/$/, '') : d.src.split('/').slice(0, -1).join('/')) +
          '/api/send',
        w = n + 'x' + r,
        N = /data-umami-event-([\w-_]+)/,
        T = m + 'umami-event',
        j = 300,
        A = function (t, e, n) {
          var r = t[e]
          return function () {
            for (var e = [], a = arguments.length; a--; ) e[a] = arguments[a]
            return n.apply(null, e), r.apply(t, e)
          }
        },
        x = function () {
          return {
            website: v,
            hostname: f,
            screen: w,
            language: a,
            title: M,
            url: I,
            referrer: J,
          }
        },
        E = function () {
          return (
            (o && o.getItem('umami.disabled')) ||
            (y &&
              (function () {
                var e = t.doNotTrack,
                  n = t.navigator,
                  r = t.external,
                  a = 'msTrackingProtectionEnabled',
                  i =
                    e ||
                    n.doNotTrack ||
                    n.msDoNotTrack ||
                    (r && a in r && r[a]())
                return '1' == i || 'yes' === i
              })()) ||
            (b && !S.includes(f))
          )
        },
        O = function (t, e, n) {
          n &&
            ((J = I),
            (I = (function (t) {
              try {
                return new URL(t).pathname
              } catch (e) {
                return t
              }
            })(n.toString())) !== J && setTimeout(D, j))
        },
        L = function (t, e) {
          if ((void 0 === e && (e = 'event'), !E())) {
            var n = {
              // eslint-disable-next-line @typescript-eslint/naming-convention
              'Content-Type': 'application/json',
            }
            return (
              void 0 !== K && (n['x-umami-cache'] = K),
              fetch(k, {
                method: 'POST',
                body: JSON.stringify({
                  type: e,
                  payload: t,
                }),
                headers: n,
              })
                .then(function (t) {
                  return t.text()
                })
                .then(function (t) {
                  return (K = t)
                })
                .catch(function () {})
            )
          }
        },
        D = function (t, e) {
          return L(
            'string' == typeof t
              ? Object.assign({}, x(), {
                  name: t,
                  data: 'object' == typeof e ? e : void 0,
                })
              : 'object' == typeof t
                ? t
                : 'function' == typeof t
                  ? t(x())
                  : x()
          )
        }
      t.umami ||
        (t.umami = {
          track: D,
          identify: function (t) {
            return L(
              Object.assign({}, x(), {
                data: t,
              }),
              'identify'
            )
          },
        })
      var K,
        P,
        _,
        q,
        C,
        I = '' + s + l,
        J = u.referrer,
        M = u.title
      if (g && !E()) {
        ;(c.pushState = A(c, 'pushState', O)),
          (c.replaceState = A(c, 'replaceState', O)),
          (C = function (t) {
            var e = t.getAttribute.bind(t),
              n = e(T)
            if (n) {
              var r = {}
              return (
                t.getAttributeNames().forEach(function (t) {
                  var n = t.match(N)
                  n && (r[n[1]] = e(t))
                }),
                D(n, r)
              )
            }
            return Promise.resolve()
          }),
          u.addEventListener(
            'click',
            function (t) {
              var e = t.target,
                n =
                  'A' === e.tagName
                    ? e
                    : (function (t, e) {
                        for (var n = t, r = 0; r < e; r++) {
                          if ('A' === n.tagName) return n
                          if (!(n = n.parentElement)) return null
                        }
                        return null
                      })(e, 10)
              if (n) {
                var r = n.href,
                  a =
                    '_blank' === n.target ||
                    t.ctrlKey ||
                    t.shiftKey ||
                    t.metaKey ||
                    (t.button && 1 === t.button)
                if (n.getAttribute(T) && r)
                  return (
                    a || t.preventDefault(),
                    C(n).then(function () {
                      a || (i.href = r)
                    })
                  )
              } else C(e)
            },
            !0
          ),
          (_ = new MutationObserver(function (t) {
            var e = t[0]
            M = e && e.target ? e.target.text : void 0
          })),
          (q = u.querySelector('head > title')) &&
            _.observe(q, {
              subtree: !0,
              characterData: !0,
              childList: !0,
            })
        var R = function () {
          'complete' !== u.readyState || P || (D(), (P = !0))
        }
        u.addEventListener('readystatechange', R, !0), R()
      }
    }
  })(window)
})()
