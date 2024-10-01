
import { mainViewStateAtom } from './App.atom';
import { MainViewState } from '@/constants/screens';

test('mainViewStateAtom initializes with Thread', () => {
  const result = mainViewStateAtom.init;
  expect(result).toBe(MainViewState.Thread);
});
