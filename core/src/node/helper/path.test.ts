// @auto-generated
import { normalizeFilePath } from "./path";

import { jest } from '@jest/globals';
describe("Test file normalize", () => {
  test("returns no file protocol prefix on Unix", async () => {
    expect(normalizeFilePath("file://test.txt")).toBe("test.txt");
    expect(normalizeFilePath("file:/test.txt")).toBe("test.txt");
  });
  test("returns no file protocol prefix on Windows", async () => {
    expect(normalizeFilePath("file:\\\\test.txt")).toBe("test.txt");
    expect(normalizeFilePath("file:\\test.txt")).toBe("test.txt");
  });

  test("returns correct path when Electron is available and app is not packaged", () => {
    const electronMock = {
      app: {
        getAppPath: jest.fn().mockReturnValue("/mocked/path"),
        isPackaged: false
      },
      protocol: {}
    };
    jest.mock("electron", () => electronMock);
    const { appResourcePath } = require("./path");
    expect(appResourcePath()).toBe("/mocked/path");
  });

});
