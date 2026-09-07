import { PREVIEW_INSPECTOR_SCRIPT } from '@/lib/previewInspector'

function buildCsp(allowNetwork: boolean, allowScripts: boolean): string {
  if (!allowScripts) {
    return [
      "default-src 'none'",
      'img-src data: blob:',
      "style-src 'unsafe-inline'",
      'font-src data:',
      "connect-src 'none'",
    ].join('; ')
  }
  if (allowNetwork) {
    return [
      "default-src 'none'",
      "script-src 'unsafe-inline' https:",
      "style-src 'unsafe-inline' https:",
      'img-src data: blob: https:',
      'font-src data: https:',
      'connect-src https:',
    ].join('; ')
  }
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    "connect-src 'none'",
  ].join('; ')
}

/**
 * Wrap model markup in the sandbox shell (CSP + inspector) used for every
 * artifact preview. Lives here rather than beside the component so the Cowork
 * preview panel can render a bare, panel-filling iframe with identical
 * sandboxing instead of nesting that component's card-and-tabs chrome.
 */
export function buildSrcDoc(
  code: string,
  allowNetwork: boolean,
  allowScripts: boolean
): string {
  const csp = buildCsp(allowNetwork, allowScripts)
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`
  // Zero the shell's body margin so artifact content sits flush and the
  // element inspector can treat full-viewport wrappers as background.
  const shellStyle = '<style>html,body{margin:0}</style>'
  // Element inspection (hover outline / click-to-pin bbox) needs a script in
  // the iframe's own document, which is only possible when scripts run at all
  // (allowScripts=false is the static SVG mode).
  const inspector = allowScripts
    ? `<script>${PREVIEW_INSPECTOR_SCRIPT}</script>`
    : ''
  // Always wrap so the CSP meta precedes all model markup — a meta CSP is only
  // honored before resource-fetching content, and a later one can't loosen it.
  return `<!doctype html><html><head>${meta}${shellStyle}${inspector}</head><body>${code}</body></html>`
}
