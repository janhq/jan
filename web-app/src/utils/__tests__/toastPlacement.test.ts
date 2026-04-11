import { describe, it, expect } from 'vitest'
import {
  getDefaultNotificationPosition,
  getToastOffset,
  isNotificationPosition,
} from '../toastPlacement'

/**
 * Platform flags come from Vite `define` (compile-time). Vitest uses non-Tauri / non-Windows.
 */
describe('toastPlacement', () => {
  describe('getDefaultNotificationPosition', () => {
    it('returns top-right when not Windows Tauri (vitest env)', () => {
      expect(getDefaultNotificationPosition()).toBe('top-right')
    })
  })

  describe('getToastOffset', () => {
    it('uses base margin for top-right when not Tauri', () => {
      expect(getToastOffset('top-right')).toEqual({ top: 8, right: 8 })
    })

    it('uses base margin for corners when not Tauri', () => {
      expect(getToastOffset('top-left')).toEqual({ top: 8, left: 8 })
      expect(getToastOffset('bottom-right')).toEqual({ bottom: 8, right: 8 })
      expect(getToastOffset('bottom-left')).toEqual({ bottom: 8, left: 8 })
    })
  })

  describe('isNotificationPosition', () => {
    it('accepts corners only', () => {
      expect(isNotificationPosition('bottom-right')).toBe(true)
      expect(isNotificationPosition('top-center')).toBe(false)
    })
  })
})
