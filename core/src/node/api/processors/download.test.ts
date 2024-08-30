// @auto-generated
import { Downloader } from './download';
import { DownloadEvent } from '../../../types/api';
import { DownloadManager } from '../../helper/download';

it('should handle getFileSize errors correctly', async () => {
  const observer = jest.fn();
  const url = 'http://example.com/file';

  const downloader = new Downloader(observer);
  const requestMock = jest.fn((options, callback) => {
    callback(new Error('Test error'), null);
  });
  jest.mock('request', () => requestMock);

  await expect(downloader.getFileSize(observer, url)).rejects.toThrow('Test error');
});


it('should pause download correctly', () => {
  const observer = jest.fn();
  const fileName = 'path/to/file';

  const downloader = new Downloader(observer);
  const pauseMock = jest.fn();
  DownloadManager.instance.networkRequests[fileName] = { pause: pauseMock };

  downloader.pauseDownload(observer, fileName);

  expect(pauseMock).toHaveBeenCalled();
});


it('should resume download correctly', () => {
  const observer = jest.fn();
  const fileName = 'path/to/file';

  const downloader = new Downloader(observer);
  const resumeMock = jest.fn();
  DownloadManager.instance.networkRequests[fileName] = { resume: resumeMock };

  downloader.resumeDownload(observer, fileName);

  expect(resumeMock).toHaveBeenCalled();
});


it('should handle aborting a download correctly', () => {
  const observer = jest.fn();
  const fileName = 'path/to/file';

  const downloader = new Downloader(observer);
  const abortMock = jest.fn();
  DownloadManager.instance.networkRequests[fileName] = { abort: abortMock };

  downloader.abortDownload(observer, fileName);

  expect(abortMock).toHaveBeenCalled();
  expect(observer).toHaveBeenCalledWith(DownloadEvent.onFileDownloadError, expect.objectContaining({
    error: 'aborted'
  }));
});
