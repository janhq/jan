import { InferenceEngine, joinPath } from '@janhq/core';
import JanModelExtension from './index';
import { fs } from '@janhq/core';
import { Model } from '@janhq/core'


jest.mock('@janhq/core', () => ({
  ...jest.requireActual('@janhq/core'),
  fs: {
    existsSync: jest.fn(),
    mkdir: jest.fn(),
    writeFileSync: jest.fn(),
    readdirSync: jest.fn(),
    unlinkSync: jest.fn(),
    fileStat: jest.fn(),
    readFileSync: jest.fn(),
  },
  joinPath: jest.fn(),
}));
describe('JanModelExtension', () => {
  let janModelExtension: JanModelExtension;

  beforeEach(() => {
    janModelExtension = new JanModelExtension('test', 'test');
    jest.clearAllMocks();
  });

  describe('getModelsMetadata', () => {
    it('should return an empty array if the home directory does not exist', async () => {
      (fs.existsSync as jest.Mock).mockResolvedValue(false);

      const result = await janModelExtension.getConfiguredModels();
      expect(result).toEqual([]);
    });

    it('should return an array of models if model.json files are found', async () => {
      const mockModel: Model = {
        id: 'model1',
        name: 'Model 1',
        sources: [{ url: 'http://example.com/model1.gguf', filename: 'model1.gguf' }],
        parameters: {},
        settings: {},
        created: Date.now(),
        object: 'model',
        version: '1.0',
        engine: 'nitro' as InferenceEngine,
        format: 'gguf',
        description: '',
        metadata: { size: 123, author: 'User', tags: [] },
      };

      (fs.existsSync as jest.Mock).mockResolvedValue(true);
      (fs.readdirSync as jest.Mock).mockResolvedValue(['model1']);
      (fs.fileStat as jest.Mock).mockResolvedValue({ isDirectory: false });
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockModel));
      


      const result = await janModelExtension.getConfiguredModels();
      expect(result).toEqual([mockModel]);
    });

    it('should ignore non-existent or invalid JSON files', async () => {
      (fs.existsSync as jest.Mock).mockResolvedValue(true);
      (fs.readdirSync as jest.Mock).mockResolvedValue(['invalid_model']);
      (fs.fileStat as jest.Mock).mockResolvedValue({ isDirectory: false });
      (fs.readFileSync as jest.Mock).mockImplementation(() => { throw new Error('Invalid JSON'); });

      const result = await janModelExtension.getConfiguredModels();
      expect(result).toEqual([]);
    });

    it('should filter models based on the provided selector function', async () => {
      const mockModel: Model = {
        id: 'model3',
        name: 'Model 3',
        sources: [{ url: 'http://example.com/model3.gguf', filename: 'model3.gguf' }],
        parameters: {},
        settings: {},
        created: Date.now(),
        description: '',
        metadata: { size: 789, author: 'User', tags: [] },
        version: '1.0',
        object: 'model',
        engine: 'nitro' as InferenceEngine,
        format: 'gguf',
      };

      (fs.existsSync as jest.Mock).mockResolvedValue(true);
      (fs.readdirSync as jest.Mock).mockResolvedValue(['model3']);
      (fs.fileStat as jest.Mock).mockResolvedValue({ isDirectory: false });
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockModel));

      const result = await janModelExtension.getConfiguredModels();
      expect(result).toEqual([mockModel]);
    });
    it('model id should be the same as the directory name', async () => {
      const mockModel: Model = {
        id: 'sampleId',
        name: 'Model 4',
        sources: [{ url: 'http://example.com/model4.gguf', filename: 'model4.gguf' }],
        parameters: {},
        settings: {},
        created: Date.now(),
        description: '',
        metadata: { size: 789, author: 'User', tags: [] },
        version: '1.0',
        object: 'model',
        engine: 'nitro' as InferenceEngine,
        format: 'gguf',
      };

      (fs.existsSync as jest.Mock).mockResolvedValue(true);
      (fs.readdirSync as jest.Mock).mockResolvedValue(['sampleDir']);
      (fs.fileStat as jest.Mock).mockResolvedValue({ isDirectory: false });
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockModel));

      const result = await janModelExtension.getConfiguredModels();
      expect(result).toEqual([{
        ...mockModel,
        id: 'sampleDir',
      }]);
    });
  });
});

