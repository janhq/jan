import { Logger, LoggerManager } from './logger';

  it('should flush queued logs to registered loggers', () => {
    class TestLogger extends Logger {
      name = 'testLogger';
      log(args: any): void {
        console.log(args);
      }
    }
    const loggerManager = new LoggerManager();
    const testLogger = new TestLogger();
    loggerManager.register(testLogger);
    const logSpy = jest.spyOn(testLogger, 'log');
    loggerManager.log('test log');
    expect(logSpy).toHaveBeenCalledWith('test log');
  });


  it('should unregister a logger', () => {
    class TestLogger extends Logger {
      name = 'testLogger';
      log(args: any): void {
        console.log(args);
      }
    }
    const loggerManager = new LoggerManager();
    const testLogger = new TestLogger();
    loggerManager.register(testLogger);
    loggerManager.unregister('testLogger');
    const retrievedLogger = loggerManager.get('testLogger');
    expect(retrievedLogger).toBeUndefined();
  });


  it('should register and retrieve a logger', () => {
    class TestLogger extends Logger {
      name = 'testLogger';
      log(args: any): void {
        console.log(args);
      }
    }
    const loggerManager = new LoggerManager();
    const testLogger = new TestLogger();
    loggerManager.register(testLogger);
    const retrievedLogger = loggerManager.get('testLogger');
    expect(retrievedLogger).toBe(testLogger);
  });
