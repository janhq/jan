import { DownloadManager } from './download';

it('should set a network request for a specific file', () => {
  const downloadManager = new DownloadManager();
  const fileName = 'testFile';
  const request = { url: 'http://example.com' };
  
  downloadManager.setRequest(fileName, request);
  
  expect(downloadManager.networkRequests[fileName]).toEqual(request);
});
