import { FSExt } from './fsExt'

it('should call correct function in process method', () => {
  const fsExt = new FSExt()
  const mockFunction = jest.fn()
  ;(fsExt as any).mockFunction = mockFunction
  fsExt.process('mockFunction', 'arg1', 'arg2')
  expect(mockFunction).toHaveBeenCalledWith('arg1', 'arg2')
})

it('should return empty array when no files are provided', async () => {
  const fsExt = new FSExt()
  const result = await fsExt.getGgufFiles([])
  expect(result.supportedFiles).toEqual([])
  expect(result.unsupportedFiles).toEqual([])
})
