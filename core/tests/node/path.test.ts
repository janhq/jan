import { normalizeFilePath } from "../../src/node/helper/path";

describe("Test file normalize", () => {
  test("returns no file protocol prefix on Unix", async () => {
    expect(normalizeFilePath("file://test.txt")).toBe("test.txt");
    expect(normalizeFilePath("file:/test.txt")).toBe("test.txt");
  });
  test("returns no file protocol prefix on Windows", async () => {
    expect(normalizeFilePath("file:\\\\test.txt")).toBe("test.txt");
    expect(normalizeFilePath("file:\\test.txt")).toBe("test.txt");
  });
});
