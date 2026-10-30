import { ExtensionError } from '@janhq/extension-api'
import { parse, type Program } from 'acorn'

/** The one global a bundle defines, and the only thing it may declare. */
export const BUNDLE_GLOBAL = 'JanExtension'

const invalid = (reason: string) =>
  new ExtensionError(
    'E_INVALID_ARGS',
    `The bundle must be a single top-level 'var ${BUNDLE_GLOBAL} = <expression>' statement: ${reason}`
  )

/**
 * Refuses a bundle unless, parsed on its own as a classic script, it is
 * one `var JanExtension = <expression>` statement, optionally after a
 * 'use strict' directive (comments are free). The bundle shares one script
 * with the prelude, and every top-level declaration of a script is bound
 * on the global before its first line runs: a bundle declaring
 * `function Set() {}` or `var navigator` would be read by the prelude
 * before it strips anything. Parsing it standalone also proves it cannot
 * close anything the composition opens around it.
 *
 * The bundle then starts in a realm the prelude has locked down with SES:
 * every primordial (`Object.prototype`, `Array.prototype`, `Promise`,
 * `JSON`, ...) is frozen, `eval` and `Function` throw, and `harden` is a
 * global. A bundle that assigns to a built-in prototype at load time, as
 * some polyfills do, fails to start.
 */
export function assertBundleShape(bundle: string): void {
  let program: Program
  try {
    program = parse(bundle, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowHashBang: false,
    })
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : String(error))
  }
  const body = [...program.body]
  const first = body[0]
  if (
    first?.type === 'ExpressionStatement' &&
    first.directive === 'use strict'
  )
    body.shift()
  const [statement, ...rest] = body
  if (!statement || rest.length > 0)
    throw invalid(`found ${program.body.length} top-level statements`)
  if (statement.type !== 'VariableDeclaration' || statement.kind !== 'var')
    throw invalid(`found a top-level ${statement.type}`)
  const [declarator, ...others] = statement.declarations
  if (
    others.length > 0 ||
    declarator.id.type !== 'Identifier' ||
    declarator.id.name !== BUNDLE_GLOBAL ||
    !declarator.init
  )
    throw invalid(`it declares something other than '${BUNDLE_GLOBAL}'`)
}

/**
 * The one script a worker runs: prelude, then the extension bundle, then
 * the boot call. It has to be one script because the worker inherits the
 * window CSP, which allows neither eval nor importing blob:/data: code, so
 * the extension cannot be loaded after the prelude any other way.
 *
 * The prelude ends with SES `lockdown`, so the order inside the script is:
 * realm checks and stripping, lockdown, bundle, `__janBoot`. Lockdown is
 * the prelude's last step rather than a line of its own here: the prelude
 * calls the `lockdown` it took from SES, which a hoisted declaration of
 * the bundle cannot replace, and it must come after the realm checks,
 * which refuse the `Error` that SES installs. SES is bundled into the
 * prelude, so a worker loads nothing from the network.
 *
 * The bundle is an IIFE assigning `var JanExtension` (rolldown/esbuild
 * `format: 'iife', name: 'JanExtension'`); `assertBundleShape` enforces
 * that, and throws for anything else. The separating semicolons keep a
 * bundle without a trailing one from swallowing the next line, and the
 * newline before the trailer ends a trailing line comment.
 */
export function composeWorkerSource(prelude: string, bundle: string): string {
  assertBundleShape(bundle)
  return [
    prelude,
    `;${bundle}`,
    `;self.__janBoot(typeof ${BUNDLE_GLOBAL} === 'undefined' ? undefined : ${BUNDLE_GLOBAL})`,
    '',
  ].join('\n')
}
