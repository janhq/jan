import { displayDate } from './datetime'
import { isToday } from './datetime'

test("should return only time for today's timestamp", () => {
  const today = new Date()
  const timestamp = today.getTime()
  const expectedTime = `${today.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })}`
  expect(displayDate(timestamp / 1000)).toBe(expectedTime)
})

test('should return N/A for undefined timestamp', () => {
  expect(displayDate()).toBe('N/A')
})

test("should return true for today's timestamp", () => {
  const today = new Date()
  const timestamp = today.setHours(0, 0, 0, 0)
  expect(isToday(timestamp / 1000)).toBe(true)
})
