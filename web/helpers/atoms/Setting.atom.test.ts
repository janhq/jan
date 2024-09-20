
import { selectedSettingAtom } from './Setting.atom';

test('selectedSettingAtom has correct initial value', () => {
  const result = selectedSettingAtom.init;
  expect(result).toBe('My Models');
});
