import TensorRTLLMExtension from '../src/index'
import {
  executeOnMain,
  systemInformation,
  fs,
  baseName,
  joinPath,
  downloadFile,
} from '@janhq/core'

jest.mock('@janhq/core', () => ({
  ...jest.requireActual('@janhq/core/node'),
  LocalOAIEngine: jest.fn().mockImplementation(function () {
    // @ts-ignore
    this.registerModels = () => {
      return Promise.resolve()
    }
    // @ts-ignore
    return this
  }),
  systemInformation: jest.fn(),
  fs: {
    existsSync: jest.fn(),
    mkdir: jest.fn(),
  },
  joinPath: jest.fn(),
  baseName: jest.fn(),
  downloadFile: jest.fn(),
  executeOnMain: jest.fn(),
  showToast: jest.fn(),
  events: {
    emit: jest.fn(),
    // @ts-ignore
    on: (event, func) => {
      func({ fileName: './' })
    },
    off: jest.fn(),
  },
}))

// @ts-ignore
global.COMPATIBILITY = {
  platform: ['win32'],
}
// @ts-ignore
global.PROVIDER = 'tensorrt-llm'
// @ts-ignore
global.INFERENCE_URL = 'http://localhost:5000'
// @ts-ignore
global.NODE = 'node'
// @ts-ignore
global.MODELS = []
// @ts-ignore
global.TENSORRT_VERSION = ''
// @ts-ignore
global.DOWNLOAD_RUNNER_URL = ''

describe('TensorRTLLMExtension', () => {
  let extension: TensorRTLLMExtension

  beforeEach(() => {
    // @ts-ignore
    extension = new TensorRTLLMExtension()
    jest.clearAllMocks()
  })

  describe('compatibility', () => {
    it('should return the correct compatibility', () => {
      const result = extension.compatibility()
      expect(result).toEqual({
        platform: ['win32'],
      })
    })
  })

  describe('install', () => {
    it('should install if compatible', async () => {
      const mockSystemInfo: any = {
        osInfo: { platform: 'win32' },
        gpuSetting: { gpus: [{ arch: 'ampere', name: 'NVIDIA GPU' }] },
      }
      ;(executeOnMain as jest.Mock).mockResolvedValue({})
      ;(systemInformation as jest.Mock).mockResolvedValue(mockSystemInfo)
      ;(fs.existsSync as jest.Mock).mockResolvedValue(false)
      ;(fs.mkdir as jest.Mock).mockResolvedValue(undefined)
      ;(baseName as jest.Mock).mockResolvedValue('./')
      ;(joinPath as jest.Mock).mockResolvedValue('./')
      ;(downloadFile as jest.Mock).mockResolvedValue({})

      await extension.install()

      expect(executeOnMain).toHaveBeenCalled()
    })

    it('should not install if not compatible', async () => {
      const mockSystemInfo: any = {
        osInfo: { platform: 'linux' },
        gpuSetting: { gpus: [{ arch: 'pascal', name: 'NVIDIA GPU' }] },
      }
      ;(systemInformation as jest.Mock).mockResolvedValue(mockSystemInfo)

      jest.spyOn(extension, 'registerModels').mockReturnValue(Promise.resolve())
      await extension.install()

      expect(executeOnMain).not.toHaveBeenCalled()
    })
  })

  describe('installationState', () => {
    it('should return NotCompatible if not compatible', async () => {
      const mockSystemInfo: any = {
        osInfo: { platform: 'linux' },
        gpuSetting: { gpus: [{ arch: 'pascal', name: 'NVIDIA GPU' }] },
      }
      ;(systemInformation as jest.Mock).mockResolvedValue(mockSystemInfo)

      const result = await extension.installationState()

      expect(result).toBe('NotCompatible')
    })

    it('should return Installed if executable exists', async () => {
      const mockSystemInfo: any = {
        osInfo: { platform: 'win32' },
        gpuSetting: { gpus: [{ arch: 'ampere', name: 'NVIDIA GPU' }] },
      }
      ;(systemInformation as jest.Mock).mockResolvedValue(mockSystemInfo)
      ;(fs.existsSync as jest.Mock).mockResolvedValue(true)

      const result = await extension.installationState()

      expect(result).toBe('Installed')
    })

    it('should return NotInstalled if executable does not exist', async () => {
      const mockSystemInfo: any = {
        osInfo: { platform: 'win32' },
        gpuSetting: { gpus: [{ arch: 'ampere', name: 'NVIDIA GPU' }] },
      }
      ;(systemInformation as jest.Mock).mockResolvedValue(mockSystemInfo)
      ;(fs.existsSync as jest.Mock).mockResolvedValue(false)

      const result = await extension.installationState()

      expect(result).toBe('NotInstalled')
    })
  })

  describe('isCompatible', () => {
    it('should return true for compatible system', () => {
      const mockInfo: any = {
        osInfo: { platform: 'win32' },
        gpuSetting: { gpus: [{ arch: 'ampere', name: 'NVIDIA GPU' }] },
      }

      const result = extension.isCompatible(mockInfo)

      expect(result).toBe(true)
    })

    it('should return false for incompatible system', () => {
      const mockInfo: any = {
        osInfo: { platform: 'linux' },
        gpuSetting: { gpus: [{ arch: 'pascal', name: 'AMD GPU' }] },
      }

      const result = extension.isCompatible(mockInfo)

      expect(result).toBe(false)
    })
  })
})

describe('GitHub Release File URL Test', () => {
  const url = 'https://github.com/janhq/cortex.tensorrt-llm/releases/download/windows-v0.1.8-tensorrt-llm-v0.7.1/nitro-windows-v0.1.8-tensorrt-llm-v0.7.1-amd64-all-arch.tar.gz';

  it('should return a status code 200 for the release file URL', async () => {
    const response = await fetch(url, { method: 'HEAD' });
    expect(response.status).toBe(200);
  });

  it('should not return a 404 status', async () => {
    const response = await fetch(url, { method: 'HEAD' });
    expect(response.status).not.toBe(404);
  });
});
