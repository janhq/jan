import { JanApiRouteConfiguration } from './configuration'

describe('JanApiRouteConfiguration', () => {
  it('should have the correct models configuration', () => {
    const modelsConfig = JanApiRouteConfiguration.models;
    expect(modelsConfig.dirName).toBe('models');
    expect(modelsConfig.metadataFileName).toBe('model.json');
    expect(modelsConfig.delete.object).toBe('model');
  });

  it('should have the correct assistants configuration', () => {
    const assistantsConfig = JanApiRouteConfiguration.assistants;
    expect(assistantsConfig.dirName).toBe('assistants');
    expect(assistantsConfig.metadataFileName).toBe('assistant.json');
    expect(assistantsConfig.delete.object).toBe('assistant');
  });

  it('should have the correct threads configuration', () => {
    const threadsConfig = JanApiRouteConfiguration.threads;
    expect(threadsConfig.dirName).toBe('threads');
    expect(threadsConfig.metadataFileName).toBe('thread.json');
    expect(threadsConfig.delete.object).toBe('thread');
  });
});