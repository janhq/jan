
import { createSettingComponent } from './settingComponent';

    it('should throw an error when creating a setting component with invalid controller type', () => {
      const props: SettingComponentProps = {
        key: 'invalidControllerKey',
        title: 'Invalid Controller Title',
        description: 'Invalid Controller Description',
        controllerType: 'invalid' as any,
        controllerProps: {
          placeholder: 'Enter text',
          value: 'Initial Value',
          type: 'text',
          textAlign: 'left',
          inputActions: ['unobscure'],
        },
      };
      expect(() => createSettingComponent(props)).toThrowError();
    });
