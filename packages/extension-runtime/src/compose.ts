/**
 * The one script a worker runs: prelude, then the extension bundle, then
 * the boot call. It has to be one script because the worker inherits the
 * window CSP, which allows neither eval nor importing blob:/data: code, so
 * the extension cannot be loaded after the prelude any other way.
 *
 * The bundle is an IIFE assigning `var JanExtension` (rolldown/esbuild
 * `format: 'iife', name: 'JanExtension'`). The separating semicolons keep a
 * bundle without a trailing one from swallowing the next line, and the
 * newline before the trailer ends a trailing line comment.
 */
export function composeWorkerSource(prelude: string, bundle: string): string {
  return [
    prelude,
    `;${bundle}`,
    ";self.__janBoot(typeof JanExtension === 'undefined' ? undefined : JanExtension)",
    '',
  ].join('\n')
}
