

import { test, expect } from 'vitest'
import { NativeRoute } from '../index';

test('testNativeRouteEnum', () => {
  expect(NativeRoute.openExternalUrl).toBe('openExternalUrl');
  expect(NativeRoute.openAppDirectory).toBe('openAppDirectory');
  expect(NativeRoute.openFileExplore).toBe('openFileExplorer');
  expect(NativeRoute.selectDirectory).toBe('selectDirectory');
  expect(NativeRoute.selectFiles).toBe('selectFiles');
  expect(NativeRoute.relaunch).toBe('relaunch');
  expect(NativeRoute.setNativeThemeLight).toBe('setNativeThemeLight');
  expect(NativeRoute.setNativeThemeDark).toBe('setNativeThemeDark');
  expect(NativeRoute.setMinimizeApp).toBe('setMinimizeApp');
  expect(NativeRoute.setCloseApp).toBe('setCloseApp');
  expect(NativeRoute.setMaximizeApp).toBe('setMaximizeApp');
  expect(NativeRoute.showOpenMenu).toBe('showOpenMenu');
  expect(NativeRoute.hideQuickAskWindow).toBe('hideQuickAskWindow');
  expect(NativeRoute.sendQuickAskInput).toBe('sendQuickAskInput');
  expect(NativeRoute.hideMainWindow).toBe('hideMainWindow');
  expect(NativeRoute.showMainWindow).toBe('showMainWindow');
  expect(NativeRoute.quickAskSizeUpdated).toBe('quickAskSizeUpdated');
  expect(NativeRoute.ackDeepLink).toBe('ackDeepLink');
});
