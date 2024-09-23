
import { ExtensionTypeEnum } from '../extension';
import { MonitoringExtension } from './monitoring';

it('should have the correct type', () => {
  class TestMonitoringExtension extends MonitoringExtension {
    getGpuSetting(): Promise<GpuSetting | undefined> {
      throw new Error('Method not implemented.');
    }
    getResourcesInfo(): Promise<any> {
      throw new Error('Method not implemented.');
    }
    getCurrentLoad(): Promise<any> {
      throw new Error('Method not implemented.');
    }
    getOsInfo(): Promise<OperatingSystemInfo> {
      throw new Error('Method not implemented.');
    }
  }
  const monitoringExtension = new TestMonitoringExtension();
  expect(monitoringExtension.type()).toBe(ExtensionTypeEnum.SystemMonitoring);
});


it('should create an instance of MonitoringExtension', () => {
  class TestMonitoringExtension extends MonitoringExtension {
    getGpuSetting(): Promise<GpuSetting | undefined> {
      throw new Error('Method not implemented.');
    }
    getResourcesInfo(): Promise<any> {
      throw new Error('Method not implemented.');
    }
    getCurrentLoad(): Promise<any> {
      throw new Error('Method not implemented.');
    }
    getOsInfo(): Promise<OperatingSystemInfo> {
      throw new Error('Method not implemented.');
    }
  }
  const monitoringExtension = new TestMonitoringExtension();
  expect(monitoringExtension).toBeInstanceOf(MonitoringExtension);
});
