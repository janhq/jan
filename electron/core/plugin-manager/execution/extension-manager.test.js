import { add, remove, register, get, execute, executeSerial, unregisterAll } from './extension-manager'
import ExtensionPoint from './ExtensionPoint'

beforeEach(() => {
  add('ep1')
  add('ep2')
})

afterEach(() => {
  remove('ep1')
  remove('ep2')
  remove('ep3')
})

describe('get', () => {
  it('should return the extension point with the given name if it exists', () => {
    expect(get('ep1')).toBeInstanceOf(ExtensionPoint)
  })

  it('should return all extension points if no name is provided', () => {
    expect(get()).toEqual(expect.objectContaining({ ep1: expect.any(ExtensionPoint) }))
    expect(get()).toEqual(expect.objectContaining({ ep2: expect.any(ExtensionPoint) }))
  })
})

describe('Add and remove', () => {
  it('should add a new extension point with the given name using the add function', () => {
    add('ep1')

    expect(get('ep1')).toBeInstanceOf(ExtensionPoint)
  })

  it('should remove only the extension point with the given name using the remove function', () => {
    remove('ep1')

    expect(get()).not.toEqual(expect.objectContaining({ ep1: expect.anything() }))
    expect(get()).toEqual(expect.objectContaining({ ep2: expect.any(ExtensionPoint) }))
  })

  it('should not remove any extension points if no name is provided using the remove function', () => {
    remove()

    expect(get()).toEqual(expect.objectContaining({ ep1: expect.any(ExtensionPoint) }))
    expect(get()).toEqual(expect.objectContaining({ ep2: expect.any(ExtensionPoint) }))
  })
})

describe('register', () => {
  it('should register an extension to an existing extension point if the point has already been created', () => {
    register('ep1', 'extension1', { foo: 'bar' })

    expect(get('ep1')._extensions).toContainEqual(expect.objectContaining({ name: 'extension1' }))
  })

  it('should create an extension point and register an extension to it if the point has not yet been created', () => {
    register('ep3', 'extension1', { foo: 'bar' })

    expect(get('ep3')._extensions).toContainEqual(expect.objectContaining({ name: 'extension1' }))
  })
})

describe('unregisterAll', () => {
  it('should unregister all extension points matching the give name regex', () => {
    // Register example extensions
    register('ep1', 'remove1', { foo: 'bar' })
    register('ep2', 'remove2', { foo: 'bar' })
    register('ep1', 'keep', { foo: 'bar' })

    // Remove matching extensions
    unregisterAll(/remove/)

    // Extract all registered extensions
    const eps = Object.values(get()).map(ep => ep._extensions)
    const extensions = eps.flat()

    // Test extracted extensions
    expect(extensions).toContainEqual(expect.objectContaining({ name: 'keep' }))
    expect(extensions).not.toContainEqual(expect.objectContaining({ name: 'ep1' }))
    expect(extensions).not.toContainEqual(expect.objectContaining({ name: 'ep2' }))
  })
})

describe('execute', () => {
  it('should execute the extensions registered to the named extension point with the provided input', () => {
    const result = []
    register('ep1', 'extension1', input => result.push(input + 'bar'))
    register('ep1', 'extension2', input => result.push(input + 'baz'))

    execute('ep1', 'foo')

    expect(result).toEqual(['foobar', 'foobaz'])
  })

  it('should throw an error if the named extension point does not exist', () => {
    register('ep1', 'extension1', { foo: 'bar' })

    expect(() => execute('ep3')).toThrow(/not a valid extension point/)
  })
})

describe('executeSerial', () => {
  it('should execute the extensions in serial registered to the named extension point with the provided input', async () => {
    register('ep1', 'extension1', input => input + 'bar')
    register('ep1', 'extension2', input => input + 'baz')

    const result = await executeSerial('ep1', 'foo')

    expect(result).toEqual('foobarbaz')
  })

  it('should throw an error if the named extension point does not exist', () => {
    register('ep1', 'extension1', { foo: 'bar' })

    expect(() => executeSerial('ep3')).toThrow(/not a valid extension point/)
  })
})
