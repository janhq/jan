

  import { AppConfigurationEventName } from './appConfigEvent';
  
  describe('AppConfigurationEventName', () => {
    it('should have the correct value for OnConfigurationUpdate', () => {
      expect(AppConfigurationEventName.OnConfigurationUpdate).toBe('OnConfigurationUpdate');
    });
  });
