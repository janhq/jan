import { describe, expect, it } from 'vitest'
import { PermissionDispatcher } from '../dispatcher'

describe('PermissionDispatcher', () => {
  it('grants exactly what was granted, per extension', () => {
    const d = new PermissionDispatcher()
    d.grant('acme.one', ['ui:notify'])
    expect(d.has('acme.one', 'ui:notify')).toBe(true)
    expect(d.has('acme.one', 'tools')).toBe(false)
    expect(d.has('acme.two', 'ui:notify')).toBe(false)
    expect(() => d.check('acme.one', 'ui:notify')).not.toThrow()
    expect(() => d.check('acme.one', 'tools')).toThrowError(
      expect.objectContaining({ code: 'E_PERMISSION' })
    )
  })

  it('matches network permissions by host, wildcards included', () => {
    const d = new PermissionDispatcher()
    d.grant('acme.one', ['network:api.acme.dev', 'network:*.cdn.dev'])
    expect(d.has('acme.one', 'network:api.acme.dev')).toBe(true)
    expect(d.has('acme.one', 'network:img.cdn.dev')).toBe(true)
    expect(d.has('acme.one', 'network:cdn.dev')).toBe(false)
    expect(d.has('acme.one', 'network:acme.dev')).toBe(false)
  })

  it('forgets an extension on revokeAll', () => {
    const d = new PermissionDispatcher()
    d.grant('acme.one', ['tools'])
    d.revokeAll('acme.one')
    expect(d.has('acme.one', 'tools')).toBe(false)
  })
})
