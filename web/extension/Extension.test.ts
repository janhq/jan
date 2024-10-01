import Extension from "./Extension";

test('should create an Extension instance with all properties', () => {
  const url = 'https://example.com';
  const name = 'Test Extension';
  const productName = 'Test Product';
  const active = true;
  const description = 'Test Description';
  const version = '1.0.0';

  const extension = new Extension(url, name, productName, active, description, version);

  expect(extension.url).toBe(url);
  expect(extension.name).toBe(name);
  expect(extension.productName).toBe(productName);
  expect(extension.active).toBe(active);
  expect(extension.description).toBe(description);
  expect(extension.version).toBe(version);
});
