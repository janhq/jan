import { getSystemResourceInfo } from './resource';

it('should return the correct system resource information with a valid CPU count', async () => {
  const mockCpuCount = 4;
  jest.spyOn(require('./config'), 'physicalCpuCount').mockResolvedValue(mockCpuCount);
  const logSpy = jest.spyOn(require('./logger'), 'log').mockImplementation(() => {});

  const result = await getSystemResourceInfo();

  expect(result).toEqual({
    numCpuPhysicalCore: mockCpuCount,
    memAvailable: 0,
  });
  expect(logSpy).toHaveBeenCalledWith(`[CORTEX]::CPU information - ${mockCpuCount}`);
});
