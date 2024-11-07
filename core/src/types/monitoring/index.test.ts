import * as monitoringInterface from './monitoringInterface'
import * as resourceInfo from './resourceInfo'

import * as index from './index'

it('should re-export all symbols from monitoringInterface and resourceInfo', () => {
  for (const key in monitoringInterface) {
    expect(index[key]).toBe(monitoringInterface[key])
  }
  for (const key in resourceInfo) {
    expect(index[key]).toBe(resourceInfo[key])
  }
})
