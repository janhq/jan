import { describe, beforeEach, it, expect, vi, afterEach } from 'vitest'

// Must mock before imports
vi.mock('@janhq/core', () => {
  return {
    executeOnMain: vi.fn().mockResolvedValue({}),
    events: {
      emit: vi.fn()
    },
    extractModelLoadParams: vi.fn().mockReturnValue({}),
    ModelEvent: {
      OnModelsUpdate: 'OnModelsUpdate',
      OnModelStopped: 'OnModelStopped'
    },
    EngineEvent: {
      OnEngineUpdate: 'OnEngineUpdate'
    },
    InferenceEngine: {
      cortex: 'cortex',
      nitro: 'nitro',
      cortex_llamacpp: 'cortex_llamacpp'
    },
    LocalOAIEngine: class LocalOAIEngine {
      onLoad() {}
      onUnload() {}
    }
  }
})

import JanInferenceCortexExtension, { Settings } from './index'
import { InferenceEngine, ModelEvent, EngineEvent, executeOnMain, events } from '@janhq/core'
import ky from 'ky'

// Mock global variables
const CORTEX_API_URL = 'http://localhost:3000'
const CORTEX_SOCKET_URL = 'ws://localhost:3000'
const SETTINGS = [
  { id: 'n_parallel', name: 'Parallel Execution', description: 'Number of parallel executions', type: 'number', value: '4' },
  { id: 'cont_batching', name: 'Continuous Batching', description: 'Enable continuous batching', type: 'boolean', value: true },
  { id: 'caching_enabled', name: 'Caching', description: 'Enable caching', type: 'boolean', value: true },
  { id: 'flash_attn', name: 'Flash Attention', description: 'Enable flash attention', type: 'boolean', value: true },
  { id: 'cache_type', name: 'Cache Type', description: 'Type of cache to use', type: 'string', value: 'f16' },
  { id: 'use_mmap', name: 'Use Memory Map', description: 'Use memory mapping', type: 'boolean', value: true },
  { id: 'cpu_threads', name: 'CPU Threads', description: 'Number of CPU threads', type: 'number', value: '' }
]
const NODE = 'node'

// Mock globals
vi.stubGlobal('CORTEX_API_URL', CORTEX_API_URL)
vi.stubGlobal('CORTEX_SOCKET_URL', CORTEX_SOCKET_URL)
vi.stubGlobal('SETTINGS', SETTINGS)
vi.stubGlobal('NODE', NODE)
vi.stubGlobal('window', {
  addEventListener: vi.fn()
})

// Mock WebSocket
class MockWebSocket {
  url :string
  listeners: {}
  onclose: Function 
  
  constructor(url) {
    this.url = url
    this.listeners = {}
  }

  addEventListener(event, listener) {
    this.listeners[event] = listener
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event](data)
    }
  }

  close() {
    if (this.onclose) {
      this.onclose({ code: 1000 })
    }
  }
}

// Mock global WebSocket
// @ts-ignore
global.WebSocket = vi.fn().mockImplementation((url) => new MockWebSocket(url))

describe('JanInferenceCortexExtension', () => {
  let extension
  
  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks()
    
    // Create a new instance for each test
    extension = new JanInferenceCortexExtension()
    
    // Mock the getSetting method
    extension.getSetting = vi.fn().mockImplementation((key, defaultValue) => {
      switch(key) {
        case Settings.n_parallel:
          return '4'
        case Settings.cont_batching:
          return true
        case Settings.caching_enabled:
          return true
        case Settings.flash_attn:
          return true
        case Settings.cache_type:
          return 'f16'
        case Settings.use_mmap:
          return true
        case Settings.cpu_threads:
          return ''
        default:
          return defaultValue
      }
    })
    
    // Mock methods
    extension.registerSettings = vi.fn()
    extension.onLoad = vi.fn()
    extension.clean = vi.fn().mockResolvedValue({})
    extension.healthz = vi.fn().mockResolvedValue({})
    extension.subscribeToEvents = vi.fn()
  })
  
  describe('onSettingUpdate', () => {
    it('should update n_parallel setting correctly', () => {
      extension.onSettingUpdate(Settings.n_parallel, '8')
      expect(extension.n_parallel).toBe(8)
    })
    
    it('should update cont_batching setting correctly', () => {
      extension.onSettingUpdate(Settings.cont_batching, false)
      expect(extension.cont_batching).toBe(false)
    })
    
    it('should update caching_enabled setting correctly', () => {
      extension.onSettingUpdate(Settings.caching_enabled, false)
      expect(extension.caching_enabled).toBe(false)
    })
    
    it('should update flash_attn setting correctly', () => {
      extension.onSettingUpdate(Settings.flash_attn, false)
      expect(extension.flash_attn).toBe(false)
    })
    
    it('should update cache_type setting correctly', () => {
      extension.onSettingUpdate(Settings.cache_type, 'f32')
      expect(extension.cache_type).toBe('f32')
    })
    
    it('should update use_mmap setting correctly', () => {
      extension.onSettingUpdate(Settings.use_mmap, false)
      expect(extension.use_mmap).toBe(false)
    })
    
    it('should update cpu_threads setting correctly', () => {
      extension.onSettingUpdate(Settings.cpu_threads, '4')
      expect(extension.cpu_threads).toBe(4)
    })
    
    it('should not update cpu_threads when value is not a number', () => {
      extension.cpu_threads = undefined
      extension.onSettingUpdate(Settings.cpu_threads, 'not-a-number')
      expect(extension.cpu_threads).toBeUndefined()
    })
  })
  
  describe('onUnload', () => {
    it('should clean up resources correctly', async () => {
      extension.shouldReconnect = true
      
      await extension.onUnload()
      
      expect(extension.shouldReconnect).toBe(false)
      expect(extension.clean).toHaveBeenCalled()
      expect(executeOnMain).toHaveBeenCalledWith(NODE, 'dispose')
    })
  })
  
  describe('loadModel', () => {
    it('should remove llama_model_path and mmproj from settings', async () => {
      // Setup
      const model = {
        id: 'test-model',
        settings: {
          llama_model_path: '/path/to/model',
          mmproj: '/path/to/mmproj',
          some_setting: 'value'
        },
        engine: InferenceEngine.cortex_llamacpp
      }
      
      // Mock ky.post
      vi.spyOn(ky, 'post').mockImplementation(() => ({
        // @ts-ignore
        json: () => Promise.resolve({}),
        catch: () => ({
          finally: () => ({
            // @ts-ignore
            then: () => Promise.resolve({})
          })
        })
      }))
      
      // Setup queue for testing
      extension.queue = { add: vi.fn(fn => fn()) }
      
      // Execute
      await extension.loadModel(model)
      
      // Verify settings were filtered
      expect(model.settings).not.toHaveProperty('llama_model_path')
      expect(model.settings).not.toHaveProperty('mmproj')
      expect(model.settings).toHaveProperty('some_setting')
    })
    
    it('should convert nitro to cortex_llamacpp engine', async () => {
      // Setup
      const model = {
        id: 'test-model',
        settings: {},
        engine: InferenceEngine.nitro
      }
      
      // Mock ky.post
      const mockKyPost = vi.spyOn(ky, 'post').mockImplementation(() => ({
        // @ts-ignore
        json: () => Promise.resolve({}),
        catch: () => ({
          finally: () => ({
            // @ts-ignore
            then: () => Promise.resolve({})
          })
        })
      }))
      
      // Setup queue for testing
      extension.queue = { add: vi.fn(fn => fn()) }
      
      // Execute
      await extension.loadModel(model)
      
      // Verify API call
      expect(mockKyPost).toHaveBeenCalledWith(
        `${CORTEX_API_URL}/v1/models/start`,
        expect.objectContaining({
          json: expect.objectContaining({
            engine: InferenceEngine.cortex_llamacpp
          })
        })
      )
    })
  })
  
  describe('unloadModel', () => {
    it('should call the correct API endpoint and abort loading if in progress', async () => {
      // Setup
      const model = { id: 'test-model' }
      const mockAbort = vi.fn()
      extension.abortControllers.set(model.id, { abort: mockAbort })
      
      // Mock ky.post
      const mockKyPost = vi.spyOn(ky, 'post').mockImplementation(() => ({
        // @ts-ignore
        json: () => Promise.resolve({}),
        finally: () => ({
          // @ts-ignore
          then: () => Promise.resolve({})
        })
      }))
      
      // Execute
      await extension.unloadModel(model)
      
      // Verify API call
      expect(mockKyPost).toHaveBeenCalledWith(
        `${CORTEX_API_URL}/v1/models/stop`,
        expect.objectContaining({
          json: { model: model.id }
        })
      )
      
      // Verify abort controller was called
      expect(mockAbort).toHaveBeenCalled()
    })
  })
  
  describe('clean', () => {
    it('should make a DELETE request to destroy process manager', async () => {
      // Mock the ky.delete function directly
      const mockDelete = vi.fn().mockReturnValue({
        catch: vi.fn().mockReturnValue(Promise.resolve({}))
      })
      
      // Replace the original implementation
      vi.spyOn(ky, 'delete').mockImplementation(mockDelete)
      
      // Override the clean method to use the real implementation
      // @ts-ignore
      extension.clean = JanInferenceCortexExtension.prototype.clean
      
      // Call the method
      await extension.clean()
      
      // Verify the correct API call was made
      expect(mockDelete).toHaveBeenCalledWith(
        `${CORTEX_API_URL}/processmanager/destroy`,
        expect.objectContaining({
          timeout: 2000,
          retry: expect.objectContaining({
            limit: 0
          })
        })
      )
    })
  })
  
  describe('WebSocket events', () => {
    it('should handle WebSocket events correctly', () => {
      // Create a mock implementation for subscribeToEvents that stores the socket
      let messageHandler;
      let closeHandler;
      
      // Override the private method
      extension.subscribeToEvents = function() {
        this.socket = new MockWebSocket('ws://localhost:3000/events');
        this.socket.addEventListener('message', (event) => {
          const data = JSON.parse(event.data);
          
          // Store for testing
          messageHandler = data;
          
          const transferred = data.task.items.reduce(
            (acc, cur) => acc + cur.downloadedBytes,
            0
          );
          const total = data.task.items.reduce(
            (acc, cur) => acc + cur.bytes,
            0
          );
          const percent = total > 0 ? transferred / total : 0;
          
          events.emit(
            data.type === 'DownloadUpdated' ? 'onFileDownloadUpdate' :
            data.type === 'DownloadSuccess' ? 'onFileDownloadSuccess' : 
            data.type,
            {
              modelId: data.task.id,
              percent: percent,
              size: {
                transferred: transferred,
                total: total,
              },
              downloadType: data.task.type,
            }
          );
          
          if (data.task.type === 'Engine') {
            events.emit(EngineEvent.OnEngineUpdate, {
              type: data.type,
              percent: percent,
              id: data.task.id,
            });
          }
          else if (data.type === 'DownloadSuccess') {
            setTimeout(() => {
              events.emit(ModelEvent.OnModelsUpdate, {
                fetch: true,
              });
            }, 500);
          }
        });
        
        this.socket.onclose = (event) => {
          closeHandler = event;
          // Notify app to update model running state
          events.emit(ModelEvent.OnModelStopped, {});
        };
      };
      
      // Setup queue
      extension.queue = {
        add: vi.fn(fn => fn())
      };
      
      // Execute the method
      extension.subscribeToEvents();
      
      // Simulate a message event
      extension.socket.listeners.message({
        data: JSON.stringify({
          type: 'DownloadUpdated',
          task: {
            id: 'test-model',
            type: 'Model',
            items: [
              { downloadedBytes: 50, bytes: 100 }
            ]
          }
        })
      });
      
      // Verify event emission
      expect(events.emit).toHaveBeenCalledWith(
        'onFileDownloadUpdate',
        expect.objectContaining({
          modelId: 'test-model',
          percent: 0.5
        })
      );
      
      // Simulate a download success event
      vi.useFakeTimers();
      extension.socket.listeners.message({
        data: JSON.stringify({
          type: 'DownloadSuccess',
          task: {
            id: 'test-model',
            type: 'Model',
            items: [
              { downloadedBytes: 100, bytes: 100 }
            ]
          }
        })
      });
      
      // Fast-forward time to trigger the timeout
      vi.advanceTimersByTime(500);
      
      // Verify the ModelEvent.OnModelsUpdate event was emitted
      expect(events.emit).toHaveBeenCalledWith(
        ModelEvent.OnModelsUpdate,
        { fetch: true }
      );
      
      vi.useRealTimers();
      
      // Trigger websocket close
      extension.socket.onclose({ code: 1000 });
      
      // Verify OnModelStopped event was emitted
      expect(events.emit).toHaveBeenCalledWith(
        ModelEvent.OnModelStopped, 
        {}
      );
    });
  })
})