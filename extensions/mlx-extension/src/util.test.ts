import { describe, expect, it } from 'vitest'
import { isAbsoluteModelPath, isValidModelId } from './index'

describe('isAbsoluteModelPath', () => {
  it('treats unix absolute paths as absolute', () => {
    expect(isAbsoluteModelPath('/home/user/model.safetensors')).toBe(true)
  })

  it('treats windows drive paths as absolute', () => {
    expect(isAbsoluteModelPath('C:/models/model.safetensors')).toBe(true)
  })

  it('treats mlx-relative paths as not absolute', () => {
    expect(isAbsoluteModelPath('mlx/models/foo/model.safetensors')).toBe(false)
  })

  it('treats bare relative paths as not absolute', () => {
    expect(isAbsoluteModelPath('model.safetensors')).toBe(false)
  })
})

describe('isValidModelId', () => {
  it('accepts alphanumeric ids with allowed separators', () => {
    expect(isValidModelId('org/Model-Name_1.2')).toBe(true)
  })

  it('rejects ids containing disallowed characters', () => {
    expect(isValidModelId('bad id')).toBe(false)
    expect(isValidModelId('bad$id')).toBe(false)
  })

  it('rejects empty ids', () => {
    expect(isValidModelId('')).toBe(false)
  })

  it('rejects path traversal segments', () => {
    expect(isValidModelId('../etc/passwd')).toBe(false)
    expect(isValidModelId('a/../b')).toBe(false)
    expect(isValidModelId('a/./b')).toBe(false)
  })

  it('rejects empty path segments', () => {
    expect(isValidModelId('a//b')).toBe(false)
  })
})
