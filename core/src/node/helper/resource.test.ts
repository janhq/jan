import { getSystemResourceInfo } from './resource'

it('should return the correct system resource information with a valid CPU count', async () => {
  const result = await getSystemResourceInfo()

  expect(result).toEqual({
    memAvailable: 0,
  })
})
