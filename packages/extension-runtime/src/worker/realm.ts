// Evaluated first in the prelude (see prelude.ts), before any other module
// of it. The prelude and the bundle share one classic script, so a bundle's
// top-level `function Set() {}` is bound on the global before this line
// runs. The host refuses such bundles (assertBundleShape); this is the
// second line: it takes what it can from syntax, checks every global the
// prelude reads against shapes a hoisted declaration cannot produce, and
// throws, aborting the script, before anything calls one of them.
//
// A hoisted declaration can only leave a name `undefined` (a `var` over a
// missing name) or bind a fresh function of the bundle whose properties are
// still the defaults: it runs no code until called, and nothing here calls a
// global. So an object check rules out the first, a prototype method check
// the second, and an identity check against syntax both.
//
// Only the stripping has to be beyond the bundle's reach. Once it is done,
// the bundle may replace any global, but the rest of the worker runtime
// only ever reaches the host's checked API, so that gains it nothing.

const ObjectCtor = {}.constructor as ObjectConstructor
const ArrayCtor = [].constructor as ArrayConstructor
const NumberCtor = (0).constructor as NumberConstructor
const StringCtor = ''.constructor as StringConstructor
const PromiseCtor = (async () => undefined)().constructor as PromiseConstructor
const AsyncFunctionProto = ObjectCtor.getPrototypeOf(async () => undefined)
// Reducing an empty array without a seed throws a TypeError, whose
// prototype chain leads to Error with no global lookup.
function caught(): unknown {
  try {
    ;([] as number[]).reduce((a, b) => a + b)
  } catch (error) {
    return error
  }
  return undefined
}
const ErrorCtor = ObjectCtor.getPrototypeOf(
  ObjectCtor.getPrototypeOf(caught())
).constructor as ErrorConstructor

const { getPrototypeOf, getOwnPropertyDescriptor, defineProperty, hasOwn } =
  ObjectCtor

const replaced = (name: string) =>
  new ErrorCtor(`The worker global '${name}' was replaced before the prelude ran`)

function require(ok: boolean, name: string): void {
  if (!ok) throw replaced(name)
}

const isObject = (v: unknown): v is object => typeof v === 'object' && v !== null

// A collection constructor: a hoisted function's own prototype has no `has`.
const isCollection = (v: unknown): boolean =>
  typeof v === 'function' &&
  hasOwn(v, 'prototype') &&
  typeof (v as { prototype: { has?: unknown } }).prototype.has === 'function'

// A host function such as setTimeout: not constructible, so it has no own
// `prototype`. Every function a script can declare (plain, generator, async
// generator) has one, except an async function, whose prototype differs.
const isHostFunction = (v: unknown): boolean =>
  typeof v === 'function' &&
  !hasOwn(v, 'prototype') &&
  getPrototypeOf(v) !== AsyncFunctionProto

require(Object === ObjectCtor, 'Object')
require(Array === ArrayCtor, 'Array')
require(Number === NumberCtor, 'Number')
require(String === StringCtor, 'String')
require(Promise === PromiseCtor, 'Promise')
require(Error === ErrorCtor, 'Error')
require(isObject(Reflect), 'Reflect')
require(isObject(JSON), 'JSON')
require(isCollection(Map), 'Map')
require(isCollection(Set), 'Set')
require(isObject(console), 'console')
require(isHostFunction(setTimeout), 'setTimeout')
require(isHostFunction(clearTimeout), 'clearTimeout')
require(isHostFunction(queueMicrotask), 'queueMicrotask')
require(isObject(globalThis), 'globalThis')
// The runtime keeps these for messaging, and calls `postMessage` to report
// a failed strip, while the network globals may still be in place.
require(isHostFunction(postMessage), 'postMessage')
require(isHostFunction(addEventListener), 'addEventListener')
require(isHostFunction(removeEventListener), 'removeEventListener')
require(
  typeof (globalThis as { close?: unknown }).close === 'undefined' ||
    isHostFunction((globalThis as { close?: unknown }).close),
  'close'
)

/** What the prelude uses to strip the worker, captured above. */
export interface Realm {
  global: object
  ObjectPrototype: object
  getPrototypeOf(o: object): object | null
  getOwnPropertyDescriptor(o: object, name: string): PropertyDescriptor | undefined
  defineProperty(o: object, name: string, d: PropertyDescriptor): void
  deleteProperty(o: object, name: string): boolean
  apply(fn: () => unknown, self: object): unknown
  /** The error to throw when a global turns out to have been replaced. */
  replaced(name: string): Error
}

const { deleteProperty, apply } = Reflect

export const realm: Realm = {
  global: globalThis,
  ObjectPrototype: ObjectCtor.prototype,
  getPrototypeOf,
  getOwnPropertyDescriptor,
  defineProperty: (o, name, d) => {
    defineProperty(o, name, d)
  },
  deleteProperty,
  apply: (fn, self) => apply(fn, self, []),
  replaced,
}
