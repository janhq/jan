import { getAllExtensions } from './store';
import { getActiveExtensions } from './store';
import { getExtension } from './store';

test('should return empty array when no extensions added', () => {
  expect(getAllExtensions()).toEqual([]);
});


test('should throw error when extension does not exist', () => {
  expect(() => getExtension('nonExistentExtension')).toThrow('Extension nonExistentExtension does not exist');
});

import { addExtension } from './store';
import Extension from './extension';

test('should return all extensions when multiple extensions added', () => {
  const ext1 = new Extension('ext1');
  ext1.name = 'ext1';
  const ext2 = new Extension('ext2');
  ext2.name = 'ext2';

  addExtension(ext1, false);
  addExtension(ext2, false);

  expect(getAllExtensions()).toEqual([ext1, ext2]);
});



test('should return only active extensions', () => {
  const ext1 = new Extension('ext1');
  ext1.name = 'ext1';
  ext1.setActive(true);
  const ext2 = new Extension('ext2');
  ext2.name = 'ext2';
  ext2.setActive(false);

  addExtension(ext1, false);
  addExtension(ext2, false);

  expect(getActiveExtensions()).toEqual([ext1]);
});
