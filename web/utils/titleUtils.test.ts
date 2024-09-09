
import { openFileTitle } from './titleUtils';

  test('should return "Open Containing Folder" when neither isMac nor isWindows is true', () => {
    (global as any).isMac = false;
    (global as any).isWindows = false;
    const result = openFileTitle();
    expect(result).toBe('Open Containing Folder');
  });


  test('should return "Show in File Explorer" when isWindows is true', () => {
    (global as any).isMac = false;
    (global as any).isWindows = true;
    const result = openFileTitle();
    expect(result).toBe('Show in File Explorer');
  });


  test('should return "Show in Finder" when isMac is true', () => {
    (global as any).isMac = true;
    (global as any).isWindows = false;
    const result = openFileTitle();
    expect(result).toBe('Show in Finder');
  });
