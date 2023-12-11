/* eslint-disable @typescript-eslint/no-explicit-any */
import { toast } from 'react-toastify'
const API_BASE_PATH: string = '/api/v1'

export function openExternalUrl(url: string) {
  window?.open(url, '_blank')
}

export async function appVersion() {
  return Promise.resolve(VERSION)
}

export function invokeExtensionFunc(
  modulePath: string,
  extensionFunc: string,
  ...args: any
): Promise<any> {
  return fetchApi(modulePath, extensionFunc, args).catch((err: Error) => {
    throw err
  })
}

export async function downloadFile(downloadUrl: string, fileName: string) {
  return fetchApi('', 'downloadFile', {
    downloadUrl: downloadUrl,
    fileName: fileName,
  }).catch((err: Error) => {
    throw err
  })
}

export async function deleteFile(fileName: string) {
  return fetchApi('', 'deleteFile', fileName).catch((err: Error) => {
    throw err
  })
}

export async function fetchApi(
  modulePath: string,
  extensionFunc: string,
  args: any
): Promise<any> {
  const response = await fetch(API_BASE_PATH + '/invokeFunction', {
    method: 'POST',
    body: JSON.stringify({
      modulePath: modulePath,
      method: extensionFunc,
      args: args,
    }),
    headers: { contentType: 'application/json', Authorization: '' },
  })

  if (!response.ok) {
    const json = await response.json()
    if (json && json.error) {
      toast.error(json.error, {
        position: 'bottom-left',
        autoClose: 5000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
        theme: 'light',
      })
    }
    return null
  }
  const text = await response.text()
  try {
    const json = JSON.parse(text)
    return Promise.resolve(json)
  } catch (err) {
    return Promise.resolve(text)
  }
}
