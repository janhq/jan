import Ep from './ExtensionPoint'

/** @type {Ep} */
let ep
const changeListener = jest.fn()

const objectRsp = { foo: 'bar' }
const funcRsp = arr => {
  arr || (arr = [])
  arr.push({ foo: 'baz' })
  return arr
}

beforeEach(() => {
  ep = new Ep('test-ep')
  ep.register('test-ext-obj', objectRsp)
  ep.register('test-ext-func', funcRsp, 10)
  ep.onRegister('test', changeListener)
})


it('should create a new extension point by providing a name', () => {
  expect(ep.name).toEqual('test-ep')
})

it('should register extension with extension point', () => {
  expect(ep._extensions).toContainEqual({
    name: 'test-ext-func',
    response: funcRsp,
    priority: 10
  })
})

it('should register extension with a default priority of 0 if not provided', () => {
  expect(ep._extensions).toContainEqual({
    name: 'test-ext-obj',
    response: objectRsp,
    priority: 0
  })
})

it('should execute the change listeners on registering a new extension', () => {
  changeListener.mockClear()
  ep.register('test-change-listener', true)
  expect(changeListener.mock.calls.length).toBeTruthy()
})

it('should unregister an extension with the provided name if it exists', () => {
  ep.unregister('test-ext-obj')

  expect(ep._extensions).not.toContainEqual(
    expect.objectContaining({
      name: 'test-ext-obj'
    })
  )
})

it('should not unregister any extensions if the provided name does not exist', () => {
  ep.unregister('test-ext-invalid')

  expect(ep._extensions.length).toBe(2)
})

it('should execute the change listeners on unregistering an extension', () => {
  changeListener.mockClear()
  ep.unregister('test-ext-obj')
  expect(changeListener.mock.calls.length).toBeTruthy()
})

it('should empty the registry of all extensions on clearing', () => {
  ep.clear()

  expect(ep._extensions).toEqual([])
})

it('should execute the change listeners on clearing extensions', () => {
  changeListener.mockClear()
  ep.clear()
  expect(changeListener.mock.calls.length).toBeTruthy()
})

it('should return the relevant extension using the get method', () => {
  const ext = ep.get('test-ext-obj')

  expect(ext).toEqual({ foo: 'bar' })
})

it('should return the false using the get method if the extension does not exist', () => {
  const ext = ep.get('test-ext-invalid')

  expect(ext).toBeUndefined()
})

it('should provide an array with all responses, including promises where necessary, using the execute method', async () => {
  ep.register('test-ext-async', () => new Promise(resolve => setTimeout(resolve, 0, { foo: 'delayed' })))
  const arr = ep.execute([])

  const res = await Promise.all(arr)

  expect(res).toContainEqual({ foo: 'bar' })
  expect(res).toContainEqual([{ foo: 'baz' }])
  expect(res).toContainEqual({ foo: 'delayed' })
  expect(res.length).toBe(3)
})

it('should provide an array including all responses in priority order, using the executeSerial method provided with an array', async () => {
  const res = await ep.executeSerial([])

  expect(res).toEqual([{ "foo": "bar" }, { "foo": "baz" }])
})

it('should provide an array including the last response using the executeSerial method provided with something other than an array', async () => {
  const res = await ep.executeSerial()

  expect(res).toEqual([{ "foo": "baz" }])
})
