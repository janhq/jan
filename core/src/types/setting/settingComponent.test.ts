import { it, expect } from 'vitest'
import * as SettingComponent from './settingComponent'

it('should not throw any errors when importing settingComponent', () => {
  expect(true).toBe(true)
})

it('should export SettingComponentProps type', () => {
  expect(SettingComponent).toBeDefined()
})
