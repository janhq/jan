// @auto-generated
import { getEngineConfiguration } from './config';
import { getAppConfigurations, defaultAppConfig } from './config';

it('should return undefined for invalid engine ID', async () => {
  const config = await getEngineConfiguration('invalid_engine');
  expect(config).toBeUndefined();
});


it('should return default config when CI is e2e', () => {
  process.env.CI = 'e2e';
  const config = getAppConfigurations();
  expect(config).toEqual(defaultAppConfig());
});
