import { join } from 'path'
import { readdirSync, writeFileSync, readFileSync, existsSync, mkdirSync, lstatSync } from 'fs';
import {jest,
    describe,
    it,
    beforeEach,
    expect
} from '@jest/globals'
import { getAllMessagesAndThreads, getAllLocalModels, syncModelFileToCortex } from '../../handlers/messages'
import { legacyDataPath } from './../../utils/path'
import { dump } from 'js-yaml';

jest.mock('fs', () => ({
    readdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    readFileSync: jest.fn(),
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    lstatSync: jest.fn(),
  }));

jest.mock('path')

jest.mock('js-yaml', () => ({
    dump: jest.fn(),
  }));
  
  jest.mock('./../../utils/path', () => ({
    getAppConfigurations: jest.fn(),
    legacyDataPath: jest.fn(),
  }));
  
  jest.mock('@alumna/reflect', () => jest.fn());
  const mockReflect = require('@alumna/reflect');

describe('messages.ts', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getAllMessagesAndThreads', () => {
    it('should return empty arrays if threads folder does not exist', async () => {
      (existsSync as jest.Mock).mockReturnValue(false)

      const result = await getAllMessagesAndThreads(null)

      expect(result).toEqual({ threads: [], messages: [] })
      expect(existsSync).toHaveBeenCalledWith(join(legacyDataPath(), 'threads'))
    })

    it('should return threads and messages if threads folder exists', async () => {
      const mockThreads = [
        { id: 'thread1', title: 'Thread 1' },
        { id: 'thread2', title: 'Thread 2' },
      ];
      const mockMessages = [
        { id: 'message1', thread_id: 'thread1', content: 'Message 1' },
        { id: 'message2', thread_id: 'thread2', content: 'Message 2' },
      ];
      (existsSync as jest.Mock<any>).mockReturnValue(true);
      (readdirSync as jest.Mock).mockReturnValue(['thread1', 'thread2']);
      (readFileSync as jest.Mock)
        .mockReturnValueOnce(JSON.stringify(mockThreads[0]))
        .mockReturnValueOnce(
            mockMessages.map((msg) => JSON.stringify(msg)).join('\n')
          )
        .mockReturnValueOnce(JSON.stringify(mockThreads[1]))
        .mockReturnValueOnce(
          mockMessages.map((msg) => JSON.stringify(msg)).join('\n')
        )

      const result = await getAllMessagesAndThreads(null)
        console.log(result, 'result')
      expect(result).toEqual({ threads: [
        { id: 'thread1', title: 'Thread 1' },
        { id: 'thread2', title: 'Thread 2' }
      ], messages: [
        { id: 'message1', thread_id: 'thread1', content: 'Message 1' },
        { id: 'message2', thread_id: 'thread2', content: 'Message 2' },
        { id: 'message1', thread_id: 'thread1', content: 'Message 1' },
        { id: 'message2', thread_id: 'thread2', content: 'Message 2' }
      ] })
      expect(existsSync).toHaveBeenCalledWith(join(legacyDataPath(), 'threads'))
      expect(readdirSync).toHaveBeenCalledWith(join(legacyDataPath(), 'threads'))
      expect(readFileSync).toHaveBeenCalledTimes(4)
    })
  })

  describe('getAllLocalModels', () => {
    it('should return false if models folder does not exist', async () => {
      (existsSync as jest.Mock).mockReturnValue(false)

      const result = await getAllLocalModels(null)

      expect(result).toBe(false)
      expect(existsSync).toHaveBeenCalledWith(join(legacyDataPath(), 'models'))
    })

    it('should return true if models folder exists', async () => {
      (existsSync as jest.Mock).mockReturnValue(true)
      ;(readdirSync as jest.Mock).mockReturnValue(['model1.gguf', 'model2.gguf'])

      const result = await getAllLocalModels(null)

      expect(result).toBe(true)
      expect(existsSync).toHaveBeenCalledWith(join(legacyDataPath(), 'models'))
      expect(readdirSync).toHaveBeenCalledWith(join(legacyDataPath(), 'models'))
    })

    it('should return false if models folder exists but no models are found', async () => {
        (existsSync as jest.Mock).mockReturnValue(true)
        ;(readdirSync as jest.Mock).mockReturnValue(['model1.json', 'model2.json'])
  
        const result = await getAllLocalModels(null)
  
        expect(result).toBe(false)
        expect(existsSync).toHaveBeenCalledWith(join(legacyDataPath(), 'models'))
        expect(readdirSync).toHaveBeenCalledWith(join(legacyDataPath(), 'models'))
      })
  })
  describe('syncModelFileToCortex', () => {
    const mockLegacyDataPath = 'mockLegacyDataPath';
    const mockDestinationPath = 'mockDestinationPath';
    const mockConfig = { dataFolderPath: mockDestinationPath };
  
    beforeEach(() => {
      jest.clearAllMocks();
      require('./../../utils/path').legacyDataPath.mockReturnValue(mockLegacyDataPath);
      require('./../../utils/path').getAppConfigurations.mockReturnValue(mockConfig);
    });
  
    it('should return if models folder not exist', async () => {
      (existsSync as jest.Mock).mockReturnValueOnce(false);
  
      await syncModelFileToCortex({});
        expect(existsSync).not.toHaveBeenCalled();
    });
  
    it('should skip model folder if it is not a directory', async () => {
      (existsSync as jest.Mock).mockReturnValue(true);
      (lstatSync as jest.Mock).mockReturnValue({ isDirectory: () => false });
  
      await syncModelFileToCortex({});
  
      expect(mkdirSync).not.toHaveBeenCalled();
    });
  
    it('should process model and create YAML file', async () => {
      const modelName = 'model1';
      const modelFolderPath = join(mockLegacyDataPath, 'models', modelName);
      const model = {
        id: 'model1',
        sources: [{ filename: 'file1', url: 'http://example.com/file1' }],
        settings: { ngl: 'some-ngl', ctx_len: 1024 },
        parameters: { top_p: 0.9 },
        engine: 'cortex',
      };
  
      (existsSync as jest.Mock)
        .mockReturnValueOnce(true) // for models folder existence check
        .mockReturnValueOnce(true) // for model folder existence check
        .mockReturnValueOnce(true); // for model JSON existence check
  
      (lstatSync as jest.Mock).mockReturnValue({ isDirectory: () => true });
      (readFileSync as jest.Mock).mockReturnValueOnce(JSON.stringify(model));
      (readdirSync as jest.Mock).mockReturnValue(['file1']);
      mockReflect.mockResolvedValue({ err: null });
      (dump as jest.Mock).mockReturnValue('yamlData');
  
      await syncModelFileToCortex({});
  
      expect(mkdirSync).toHaveBeenCalledWith(join(mockDestinationPath, modelName), { recursive: true });
      expect(mockReflect).toHaveBeenCalledWith({
        src: modelFolderPath,
        dest: join(mockDestinationPath, modelName),
        recursive: true,
        delete: false,
        overwrite: true,
        errorOnExist: false,
      });
      expect(writeFileSync).toHaveBeenCalledWith(join(mockDestinationPath, `${modelName}.yaml`), 'yamlData');
    });
  
    it('should handle errors and continue processing', async () => {
      const modelName = 'model2';
  
      (existsSync as jest.Mock)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true);
  
      (lstatSync as jest.Mock).mockReturnValue({ isDirectory: () => true });
      (readdirSync as jest.Mock).mockReturnValue(['file2']);
      (readFileSync as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Read Error');
      });
      (dump as jest.Mock).mockReturnValue('yamlData');
  
      await syncModelFileToCortex({});
  
      expect(console.error).toHaveBeenCalledWith(expect.any(Error));
    });
  });
})