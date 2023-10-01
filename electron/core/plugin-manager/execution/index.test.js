import { setup } from "."
import { importer, presetEPs } from "./import-manager"

describe('setup', () => {
  const mockImporter = jest.fn()

  it('should store the importer function', () => {
    setup({ importer: mockImporter })

    expect(importer).toBe(mockImporter)
  })

  it('should set presetEPS to false if not provided', () => {
    expect(presetEPs).toBe(false)
  })

  it('should set presetEPS to the provided value if it is true', () => {
    setup({ presetEPs: true })

    expect(presetEPs).toBe(true)
  })

  it('should set presetEPS to the provided value if it is null', () => {
    setup({ presetEPs: null })

    expect(presetEPs).toBe(null)
  })
})