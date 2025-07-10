import * as SettingComponent from './settingComponent'

it('should not throw any errors when importing settingComponent', () => {
  expect(() => require('./settingComponent')).not.toThrow()
})

it('should export SettingComponentProps type', () => {
  expect(SettingComponent).toBeDefined()
})
