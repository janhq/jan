import { describe, expect, it } from 'vitest'
import prelude from '../../dist/prelude-source.js'
import { assertBundleShape, composeWorkerSource } from '../index.js'

// What rolldown/esbuild emit for `format: 'iife', name: 'JanExtension'`.
const IIFE = `var JanExtension = (function(exports) {

"use strict";

function activate(ctx) {}
exports.activate = activate
return exports;
})({});
`

const rejected = (bundle: string) => () => assertBundleShape(bundle)

describe('assertBundleShape', () => {
  it('accepts a single var JanExtension, with an optional directive and comments', () => {
    expect(() => assertBundleShape(IIFE)).not.toThrow()
    expect(() =>
      assertBundleShape(`/* license */\n'use strict';\n// built\n${IIFE}// end`)
    ).not.toThrow()
    expect(() =>
      assertBundleShape('var JanExtension = { activate: function () {} }')
    ).not.toThrow()
  })

  it('rejects hoisted declarations that would run before the prelude (set.mjs, nav.mjs, obj.mjs)', () => {
    for (const hostile of [
      `function Set(items) { self.__net = fetch }\n${IIFE}`,
      `function navigator() {}\n${IIFE}`,
      `var navigator;\n${IIFE}`,
      `function Reflect() {}\nReflect.deleteProperty = function () { return true };\n${IIFE}`,
    ])
      expect(rejected(hostile)).toThrowError(
        expect.objectContaining({ code: 'E_INVALID_ARGS' })
      )
  })

  it('rejects every other top-level shape', () => {
    for (const bundle of [
      '',
      'var JanExtension',
      'var JanExtension = {}, Set = 1',
      'var Other = {}',
      'let JanExtension = {}',
      'const JanExtension = {}',
      'class JanExtension {}',
      'JanExtension = {}',
      'var JanExtension = {}; var JanExtension = {}',
      'var JanExtension = {}; self.x = 1',
      "'use client'; var JanExtension = {}",
      '#!/usr/bin/env node\nvar JanExtension = {}',
      'export var JanExtension = {}',
      'var JanExtension = {',
      'var { JanExtension } = {}',
    ])
      expect(rejected(bundle), bundle).toThrowError(
        expect.objectContaining({
          code: 'E_INVALID_ARGS',
          message: expect.stringContaining('JanExtension'),
        })
      )
  })

  it('is enforced by composeWorkerSource', () => {
    expect(() => composeWorkerSource(prelude, 'function Set() {}')).toThrowError(
      expect.objectContaining({ code: 'E_INVALID_ARGS' })
    )
    expect(composeWorkerSource(prelude, IIFE)).toContain(IIFE)
  })
})
