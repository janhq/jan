const inference = async (prompt) =>
  new Promise(async (resolve) => {
    if (window.electronAPI) {
      const response = await window.electronAPI.sendInquiry(prompt);
      resolve(response);
    }
  });

// Register all the above functions and objects with the relevant extension points
export function init({ register }) {
  register("inference", "inference", inference);
}
