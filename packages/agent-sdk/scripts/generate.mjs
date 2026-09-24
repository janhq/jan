#!/usr/bin/env node
//! Generate the SDK wire types from the committed RPC schema.
//!
//! `protocol/rpc-schema.json` is the artifact CI regenerates from the Rust
//! dispatcher (`jan cli agent rpc-schema --out protocol/rpc-schema.json`), so a
//! verb cannot change without the document moving with it. This script is the
//! other half of that guarantee: the JavaScript and Python SDKs derive their
//! request, event and enum types from the same document, and `--check` fails
//! when the committed output no longer matches it.
//!
//! One generator for both languages on purpose - the two SDKs are the same
//! client in different runtimes, and two generators would be two chances to
//! drift. Nothing here is hand-maintained except the naming rules.
//!
//! Usage:
//!   node packages/agent-sdk/scripts/generate.mjs
//!   node packages/agent-sdk/scripts/generate.mjs --schema <path> --ts <path> --py <path>
//!   node packages/agent-sdk/scripts/generate.mjs --check

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../..')

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}
const check = argv.includes('--check')
const schemaPath = resolve(flag('schema', join(repo, 'protocol/rpc-schema.json')))
const tsPath = resolve(flag('ts', join(repo, 'packages/agent-sdk/src/generated/rpc-types.d.ts')))
const jsPath = resolve(flag('js', join(repo, 'packages/agent-sdk/src/generated/rpc-types.js')))
const pyPath = resolve(flag('py', join(repo, 'sdk/python/jan_agent_sdk/_generated.py')))

const doc = JSON.parse(readFileSync(schemaPath, 'utf8'))

/// `tool_call_args_delta` -> `ToolCallArgsDelta`.
const pascal = (tag) =>
  tag
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('')

/// Collect every `$defs` entry in the document, refusing two definitions that
/// share a name but disagree: the generated names are the only identity the
/// SDKs have, so a silent redefinition would mis-type a whole field.
const defs = new Map()
const gather = (node) => {
  if (Array.isArray(node)) return node.forEach(gather)
  if (!node || typeof node !== 'object') return
  for (const [name, def] of Object.entries(node.$defs ?? {})) {
    const previous = defs.get(name)
    if (previous && JSON.stringify(previous) !== JSON.stringify(def)) {
      throw new Error(`$defs.${name} is defined twice with different shapes`)
    }
    defs.set(name, def)
  }
  for (const value of Object.values(node)) gather(value)
}
gather(doc)

/// A `$ref` to a named definition, or `null` when the node stands alone.
const refName = (node) => {
  const ref = node?.$ref
  return typeof ref === 'string' && ref.startsWith('#/$defs/') ? ref.slice('#/$defs/'.length) : null
}

/// The schema's own prose, as a comment in the target language. Rust doc
/// comments carry the contract - "reasoning never joins the assistant content"
/// is not decoration - so it is carried across rather than dropped.
const comments = (text, indent, prefix) => {
  const words = String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
  if (!words) return []
  if (prefix === '#') return [`${indent}# ${words}`]
  return [`${indent}/** ${words.replace(/\*\//g, '*\\/')} */`]
}

// ---------------------------------------------------------------------------
// TypeScript
// ---------------------------------------------------------------------------

const tsType = (node, indent = '') => {
  if (node === true || node === undefined) return 'unknown'
  if (node === false) return 'never'
  if (Array.isArray(node.enum)) return node.enum.map((v) => JSON.stringify(v)).join(' | ')
  if (node.const !== undefined) return JSON.stringify(node.const)
  const named = refName(node)
  if (named) return named
  const oneOf = node.oneOf ?? node.anyOf
  if (Array.isArray(oneOf)) return tsUnion(oneOf.map((part) => tsType(part, indent)))
  const types = Array.isArray(node.type) ? node.type : node.type ? [node.type] : []
  const parts = types.map((t) => {
    if (t === 'string') return 'string'
    if (t === 'integer' || t === 'number') return 'number'
    if (t === 'boolean') return 'boolean'
    if (t === 'null') return 'null'
    if (t === 'array') return `${tsType(node.items ?? true, indent)}[]`
    if (t === 'object') return tsInterfaceBody(node, indent)
    return 'unknown'
  })
  if (!parts.length) return node.properties ? tsInterfaceBody(node, indent) : 'unknown'
  return tsUnion(parts)
}

/// A member that accepts anything absorbs the rest of the union: `"read" |
/// unknown` is just `unknown`, and printing both would only mislead.
const tsUnion = (parts) => {
  const unique = [...new Set(parts)]
  return unique.includes('unknown') ? 'unknown' : unique.join(' | ')
}

/// An object with no named properties is `Record<string, unknown>`; anything
/// with properties keeps them, so a consumer sees the actual keys.
const tsInterfaceBody = (node, indent) => {
  const props = Object.entries(node.properties ?? {})
  if (!props.length) return 'Record<string, unknown>'
  const required = new Set(node.required ?? [])
  const inner = `${indent}  `
  const lines = props.flatMap(([name, value]) => [
    ...comments(value.description, inner, '//'),
    `${inner}${JSON.stringify(name)}${required.has(name) ? '' : '?'}: ${tsType(value, inner)}`,
  ])
  return `{\n${lines.join('\n')}\n${indent}}`
}

/// A named definition is an interface when it has properties, and an alias
/// otherwise: `HostCapability` is `"read" | "actuator"`, and printing it as an
/// empty interface would lose the union a host has to choose from.
const tsInterface = (name, node) => {
  const props = Object.entries(node.properties ?? {})
  if (!props.length) return [...comments(node.description, '', '//'), `export type ${name} = ${tsType(node)}`]
  const required = new Set(node.required ?? [])
  const lines = props.flatMap(([prop, value]) => [
    ...comments(value.description, '  ', '//'),
    `  ${JSON.stringify(prop)}${required.has(prop) ? '' : '?'}: ${tsType(value, '  ')}`,
  ])
  return [...comments(node.description, '', '//'), `export interface ${name} {`, ...lines, '}']
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

const PY_SCALARS = { string: 'str', integer: 'int', number: 'float', boolean: 'bool', null: 'None' }

const pyType = (node) => {
  if (node === true || node === undefined) return 'Any'
  if (Array.isArray(node.enum)) {
    return `Literal[${node.enum.map((v) => (typeof v === 'string' ? JSON.stringify(v) : v)).join(', ')}]`
  }
  if (node.const !== undefined) {
    return typeof node.const === 'string' ? `Literal[${JSON.stringify(node.const)}]` : `Literal[${node.const}]`
  }
  const named = refName(node)
  if (named) return named
  const oneOf = node.oneOf ?? node.anyOf
  if (Array.isArray(oneOf)) return pyUnion(oneOf.map(pyType))
  const types = Array.isArray(node.type) ? node.type : node.type ? [node.type] : []
  const mapped = types.map((t) => {
    if (t === 'array') return `list[${pyType(node.items ?? true)}]`
    return PY_SCALARS[t] ?? (t === 'object' || node.properties ? 'dict[str, Any]' : 'Any')
  })
  if (!mapped.length) return node.properties ? 'dict[str, Any]' : 'Any'
  return pyUnion(mapped)
}

/// As in TypeScript: a member that accepts anything absorbs the rest.
const pyUnion = (members) => {
  const unique = [...new Set(members)]
  if (unique.includes('Any')) return 'Any'
  return unique.length === 1 ? unique[0] : `Union[${unique.join(', ')}]`
}

/// An inline object has no name to reference, and inventing one per nesting
/// site would make the two languages disagree about the same document. The wire
/// is the same value; only the annotation is loose.
///
/// TypedDict's class syntax takes bare identifiers as keys, so a key that is
/// not one - a dotted or dashed name a host may declare - falls back to the
/// functional form, which takes string literals and keeps the same shape.
const pyTypedDict = (name, node, docstring) => {
  const props = Object.entries(node.properties ?? {})
  const required = new Set(node.required ?? [])
  const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/
  const bare = props.every(([prop]) => identifier.test(prop))
  if (!props.length && !docstring) return [`${name} = ${pyType(node)}`]
  const entry = ([prop, value], indent) => [
    ...comments(value.description, indent, '#'),
    `${indent}${bare ? prop : JSON.stringify(prop)}: ${required.has(prop) ? '' : 'NotRequired['}${pyType(value)}${required.has(prop) ? '' : ']'}`,
  ]
  if (!bare) {
    const fields = props.flatMap((prop) => entry(prop, '    '))
    return [
      `${name} = TypedDict(${JSON.stringify(name)}, {`,
      ...fields.map((line) => (line.trimStart().startsWith('#') ? line : `    ${line.trimStart()}`)),
      '})',
    ]
  }
  const lines = [`class ${name}(TypedDict):`]
  if (docstring) lines.push(`    """${docstring}"""`)
  if (!props.length) {
    lines.push('    pass')
    return lines
  }
  if (docstring) lines.push('')
  lines.push(...props.flatMap((prop) => entry(prop, '    ')))
  return lines
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

/// One request per method, but several methods share a params struct - every
/// `{sessionId}` verb is the same Rust type, and the schema titles them all
/// `SessionIdParams`. A generated name is emitted once, so the shape behind it
/// is checked rather than the name trusted.
const params = new Map()
const requests = Object.entries(doc.requests ?? {}).map(([method, node]) => {
  const name = node.title ?? `${pascal(method)}Params`
  const previous = params.get(name)
  if (previous && JSON.stringify(previous) !== JSON.stringify(node)) {
    throw new Error(`two request shapes share the generated name ${name}`)
  }
  params.set(name, node)
  return { method, name, node }
})
const paramTypes = [...params.entries()].map(([name, node]) => ({
  name,
  node,
  methods: requests.filter((request) => request.name === name).map((request) => request.method),
}))

const events = (doc.events?.oneOf ?? []).map((node) => {
  const tag = node.properties?.type?.const ?? ''
  if (!tag) throw new Error('an event carries no `type` const, so it has no tag to route on')
  return { tag, name: `${pascal(tag)}Event`, node }
})
const tags = events.map((event) => event.tag)
if (new Set(tags).size !== tags.length) throw new Error('two events carry the same `type` const')
if (new Set(events.map((event) => event.name)).size !== events.length) {
  throw new Error('two events generate the same type name')
}

/// The banner both files open with. The instruction is the same sentence in
/// both, and it names the committed schema rather than a machine-local path.
const banner = [
  'Generated from protocol/rpc-schema.json by packages/agent-sdk/scripts/generate.mjs.',
  'Do not edit by hand: run `node packages/agent-sdk/scripts/generate.mjs` after',
  'changing the Rust dispatcher, and commit the regenerated output with it.',
]

const emitTs = () => {
  const out = []
  out.push(...banner.map((line) => `// ${line}`))
  out.push('')
  // The values live in the sibling `.js`; these declarations are what a
  // TypeScript consumer sees, and the generator writes both from one list.
  out.push(`export declare const PROTOCOL_VERSION: ${doc.protocol_version}`)
  out.push('')
  out.push('/** The JSON-RPC methods this protocol accepts, in schema order. */')
  out.push('export type RpcMethod =')
  out.push(requests.map((request) => `  | ${JSON.stringify(request.method)}`).join('\n'))
  out.push('')
  out.push('/** The `type` tag of an event, which is also its `item/<tag>` method name. */')
  out.push('export type EventTag =')
  out.push(tags.map((tag) => `  | ${JSON.stringify(tag)}`).join('\n'))
  out.push('')
  out.push('export declare const EVENT_TAGS: readonly EventTag[]')
  out.push('')
  out.push('// ---------------------------------------------------------------------------')
  out.push('// Shared definitions')
  out.push('// ---------------------------------------------------------------------------')
  for (const [name, node] of [...defs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out.push('')
    out.push(...tsInterface(name, node))
  }
  out.push('')
  out.push('// ---------------------------------------------------------------------------')
  out.push('// Request parameters, one type per Rust params struct')
  out.push('// ---------------------------------------------------------------------------')
  for (const { name, node, methods } of paramTypes) {
    out.push('')
    out.push(`/** ${methods.map((method) => `\`${method}\``).join(', ')} */`)
    out.push(...tsInterface(name, node))
  }
  out.push('')
  out.push('/** The params a given method accepts, refused at compile time when they mismatch. */')
  out.push('export type RpcParams<M extends RpcMethod> =')
  for (const { name, methods } of paramTypes) {
    out.push(`  | (M extends ${methods.map((method) => JSON.stringify(method)).join(' | ')} ? ${name} : never)`)
  }
  out.push('')
  out.push('// ---------------------------------------------------------------------------')
  out.push('// Events: the payload of an `item/<tag>` notification')
  out.push('// ---------------------------------------------------------------------------')
  for (const event of events) {
    out.push('')
    out.push(...tsInterface(event.name, event.node))
  }
  out.push('')
  out.push('/** Every event a session may report, discriminated on `type`. */')
  out.push('export type StreamEvent =')
  out.push(events.map((event) => `  | ${event.name}`).join('\n'))
  out.push('')
  out.push('/** The event a given tag carries. */')
  out.push('export interface EventByTag {')
  out.push(events.map((event) => `  ${JSON.stringify(event.tag)}: ${event.name}`).join('\n'))
  out.push('}')
  out.push('')
  return out.join('\n')
}

const emitPy = () => {
  const out = []
  out.push(...banner.map((line) => `# ${line}`))
  out.push('')
  out.push('from __future__ import annotations')
  out.push('')
  out.push('from typing import Any, Literal, NotRequired, TypedDict, Union')
  out.push('')
  out.push(`PROTOCOL_VERSION = ${doc.protocol_version}`)
  out.push('')
  out.push('#: The JSON-RPC methods this protocol accepts, in schema order.')
  out.push('RPC_METHODS: tuple[str, ...] = (')
  out.push(requests.map((request) => `    ${JSON.stringify(request.method)},`).join('\n'))
  out.push(')')
  out.push('')
  out.push('#: The ``type`` tag of an event, which is also its ``item/<tag>`` method name.')
  out.push('EVENT_TAGS: tuple[str, ...] = (')
  out.push(tags.map((tag) => `    ${JSON.stringify(tag)},`).join('\n'))
  out.push(')')
  out.push('')
  out.push('RpcMethod = Literal[')
  out.push(requests.map((request) => `    ${JSON.stringify(request.method)},`).join('\n'))
  out.push(']')
  out.push('')
  out.push('EventTag = Literal[')
  out.push(tags.map((tag) => `    ${JSON.stringify(tag)},`).join('\n'))
  out.push(']')
  out.push('')
  out.push('# ' + '-'.repeat(73))
  out.push('# Shared definitions')
  out.push('# ' + '-'.repeat(73))
  for (const [name, node] of [...defs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out.push('')
    out.push(...comments(node.description, '', '#'))
    out.push(...pyTypedDict(name, node))
  }
  out.push('')
  out.push('# ' + '-'.repeat(73))
  out.push('# Request parameters, one type per Rust params struct')
  out.push('# ' + '-'.repeat(73))
  for (const { name, node, methods } of paramTypes) {
    out.push('')
    out.push(...pyTypedDict(name, node, methods.map((method) => `\`${method}\``).join(', ')))
  }
  out.push('')
  out.push('# ' + '-'.repeat(73))
  out.push('# Events: the payload of an ``item/<tag>`` notification')
  out.push('# ' + '-'.repeat(73))
  for (const event of events) {
    out.push('')
    out.push(...pyTypedDict(event.name, event.node, `\`item/${event.tag}\``))
  }
  out.push('')
  out.push('#: Every event a session may report, discriminated on ``type``.')
  out.push('StreamEvent = Union[')
  out.push(events.map((event) => `    ${event.name},`).join('\n'))
  out.push(']')
  out.push('')
  return out.join('\n')
}

/// The runtime half of the generated types: two frozen values, and nothing
/// else, so the package has no build step. The declarations they satisfy are in
/// the sibling `rpc-types.d.ts`, written from the same list in the same run.
const emitJs = () => {
  const out = []
  out.push(...banner.map((line) => `// ${line}`))
  out.push('')
  out.push(`export const PROTOCOL_VERSION = ${doc.protocol_version}`)
  out.push('')
  out.push('/** The `type` tag of every event, which is also its `item/<tag>` method name. */')
  out.push('export const EVENT_TAGS = Object.freeze([')
  out.push(tags.map((tag) => `  ${JSON.stringify(tag)},`).join('\n'))
  out.push('])')
  out.push('')
  return out.join('\n')
}

const outputs = [
  [tsPath, emitTs()],
  [jsPath, emitJs()],
  [pyPath, emitPy()],
]

if (check) {
  const stale = []
  for (const [path, expected] of outputs) {
    let actual = ''
    try {
      actual = readFileSync(path, 'utf8')
    } catch {
      stale.push(`${path} (missing)`)
      continue
    }
    if (actual !== expected) stale.push(path)
  }
  if (stale.length) {
    console.error('generated SDK types are out of date with protocol/rpc-schema.json:')
    for (const path of stale) console.error(`  ${path}`)
    console.error('run: node packages/agent-sdk/scripts/generate.mjs')
    process.exit(1)
  }
  console.log(`generated SDK types match ${schemaPath}`)
} else {
  for (const [path, text] of outputs) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
    console.log(`wrote ${path}`)
  }
}
