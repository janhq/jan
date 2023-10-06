export const toGigabytes = (input: number) => {
  if (input > 1024 ** 3) {
    return (input / 1000 ** 3).toFixed(2) + "GB";
  } else if (input > 1024 ** 2) {
    return (input / 1000 ** 2).toFixed(2) + "MB";
  } else if (input > 1024) {
    return (input / 1000).toFixed(2) + "KB";
  } else {
    return input + "B";
  }
};

export const formatDownloadPercentage = (input: number) => {
  return (input * 100).toFixed(2) + "%";
};
