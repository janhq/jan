import { extractFileName } from './path';

describe('extractFileName Function', () => {
  it('should correctly extract the file name with the provided file extension', () => {
    const url = 'http://example.com/some/path/to/file.ext';
    const fileExtension = '.ext';
    const fileName = extractFileName(url, fileExtension);
    expect(fileName).toBe('file.ext');
  });

  it('should correctly append the file extension if it does not already exist in the file name', () => {
    const url = 'http://example.com/some/path/to/file';
    const fileExtension = '.txt';
    const fileName = extractFileName(url, fileExtension);
    expect(fileName).toBe('file.txt');
  });

  it('should handle cases where the URL does not have a file extension correctly', () => {
    const url = 'http://example.com/some/path/to/file';
    const fileExtension = '.jpg';
    const fileName = extractFileName(url, fileExtension);
    expect(fileName).toBe('file.jpg');
  });

  it('should correctly handle URLs without a trailing slash', () => {
    const url = 'http://example.com/some/path/tofile';
    const fileExtension = '.txt';
    const fileName = extractFileName(url, fileExtension);
    expect(fileName).toBe('tofile.txt');
  });

  it('should correctly handle URLs with multiple file extensions', () => {
    const url = 'http://example.com/some/path/tofile.tar.gz';
    const fileExtension = '.gz';
    const fileName = extractFileName(url, fileExtension);
    expect(fileName).toBe('tofile.tar.gz');
  });

  it('should correctly handle URLs with special characters', () => {
    const url = 'http://example.com/some/path/tófílë.extë';
    const fileExtension = '.extë';
    const fileName = extractFileName(url, fileExtension);
    expect(fileName).toBe('tófílë.extë');
  });

  it('should correctly handle URLs that are just a file with no path', () => {
    const url = 'http://example.com/file.txt';
    const fileExtension = '.txt';
    const fileName = extractFileName(url, fileExtension);
    expect(fileName).toBe('file.txt');
  });

  it('should correctly handle URLs that have special query parameters', () => {
    const url = 'http://example.com/some/path/tofile.ext?query=1';
    const fileExtension = '.ext';
    const fileName = extractFileName(url.split('?')[0], fileExtension);
    expect(fileName).toBe('tofile.ext');
  });

  it('should correctly handle URLs that have uppercase characters', () => {
    const url = 'http://EXAMPLE.COM/PATH/TO/FILE.EXT';
    const fileExtension = '.ext';
    const fileName = extractFileName(url, fileExtension);
    expect(fileName).toBe('FILE.EXT');
  });

  it('should correctly handle invalid URLs', () => {
    const url = 'invalid-url';
    const fileExtension = '.txt';
    const fileName = extractFileName(url, fileExtension);
    expect(fileName).toBe('invalid-url.txt');
  });

  it('should correctly handle empty URLs', () => {
    const url = '';
    const fileExtension = '.txt';
    const fileName = extractFileName(url, fileExtension);
    expect(fileName).toBe('.txt');
  });

  it('should correctly handle undefined URLs', () => {
    const url = undefined;
    const fileExtension = '.txt';
    const fileName = extractFileName(url as any, fileExtension);
    expect(fileName).toBe('.txt');
  });
});
