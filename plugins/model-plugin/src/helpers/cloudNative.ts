import { EventName, events } from "@janhq/core";

export async function pollDownloadProgress(fileName: string) {
  if (
    typeof window !== "undefined" &&
    typeof (window as any).electronAPI === "undefined"
  ) {
    const intervalId = setInterval(() => {
      notifyProgress(fileName, intervalId);
    }, 3000);
  }
}

export async function notifyProgress(
  fileName: string,
  intervalId: NodeJS.Timeout
): Promise<string> {
  const response = await fetch("/api/v1/downloadProgress", {
    method: "POST",
    body: JSON.stringify({ fileName: fileName }),
    headers: { "Content-Type": "application/json", Authorization: "" },
  });

  if (!response.ok) {
    events.emit(EventName.OnDownloadError, null);
    clearInterval(intervalId);
    return;
  }
  const json = await response.json();
  if (isEmptyObject(json)) {
    if (!fileName && intervalId) {
      clearInterval(intervalId);
    }
    return Promise.resolve("");
  }
  if (json.success === true) {
    events.emit(EventName.OnDownloadSuccess, json);
    clearInterval(intervalId);
    return Promise.resolve("");
  } else {
    events.emit(EventName.OnDownloadUpdate, json);
    return Promise.resolve(json.fileName);
  }
}

function isEmptyObject(ojb: any): boolean {
  return Object.keys(ojb).length === 0;
}
