jest.mock('../../helper', () => ({
  ...jest.requireActual('../../helper'),
  getJanDataFolderPath: () => './app',
}))
import { App } from './app'

it('should correctly retrieve basename', () => {
  const app = new App()
  const result = app.baseName('/path/to/file.txt')
  expect(result).toBe('file.txt')
})

it('should correctly identify subdirectories', () => {
  const app = new App()
  const basePath = process.platform === 'win32' ? 'C:\\path\\to' : '/path/to'
  const subPath =
    process.platform === 'win32' ? 'C:\\path\\to\\subdir' : '/path/to/subdir'
  const result = app.isSubdirectory(basePath, subPath)
  expect(result).toBe(true)
})

it('should correctly join multiple paths', () => {
  const app = new App()
  const result = app.joinPath(['path', 'to', 'file'])
  const expectedPath =
    process.platform === 'win32' ? 'path\\to\\file' : 'path/to/file'
  expect(result).toBe(expectedPath)
})

it('should call correct function with provided arguments using process method', () => {
  const app = new App()
  const mockFunc = jest.fn()
  app.joinPath = mockFunc
  app.process('joinPath', ['path1', 'path2'])
  expect(mockFunc).toHaveBeenCalledWith(['path1', 'path2'])
})

it('should retrieve the directory name from a file path (Unix/Windows)', async () => {
  const app = new App()
  const path = 'C:/Users/John Doe/Desktop/file.txt'
  expect(await app.dirName(path)).toBe('C:/Users/John Doe/Desktop')
})

it('should retrieve the directory name when using file protocol', async () => {
  const app = new App()
  const path = 'file:/models/file.txt'
  expect(await app.dirName(path)).toBe(
    process.platform === 'win32' ? 'app\\models' : 'app/models'
  )
})
