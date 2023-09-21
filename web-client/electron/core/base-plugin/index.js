const inference = async (prompt) =>
  new Promise(async (resolve) => {
    if (window.electronAPI) {
      const response = await window.electronAPI.sendInquiry(prompt);
      resolve(response);
    }
  });

async function testInference(e) {
  e.preventDefault()
  const message = new FormData(e.target).get("message");
  const resp = await inference(message);
  alert(resp);
}

const experimentComponent = () => {
  var parent = document.createElement("div");
  const label = document.createElement("p");
  label.style.marginTop = "5px";
  label.innerText = "Inference Plugin";
  parent.appendChild(label);

  const form = document.createElement("form");
  form.id = "test";
  form.addEventListener("submit", testInference);
  const input = document.createElement("input");
  input.name = "message";
  form.appendChild(input);
  const button = document.createElement("button");
  button.type = "submit";
  button.innerText = "Test Inference";
  form.appendChild(button);

  parent.appendChild(form);
  return parent;
};

// Register all the above functions and objects with the relevant extension points
export function init({ register }) {
  register("inference", "inference", inference);
  // Experiment UI - for Preferences
  register(
    "experimentComponent",
    "base-plugin-experiment-component",
    experimentComponent
  );
}
