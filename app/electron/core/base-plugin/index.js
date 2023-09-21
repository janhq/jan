const inference = async (prompt) =>
  new Promise(async (resolve) => {
    if (window.electronAPI) {
      const response = await window.electronAPI.sendInquiry(prompt);
      resolve(response);
    }
  });

async function testInference(e) {
  e.preventDefault();
  const message = new FormData(e.target).get("message");
  const resp = await inference(message);
  alert(resp);
}

const getButton = (text, func) => {
  var element = document.createElement("button");
  element.innerText = text;
  // Add styles to the button element
  element.style.marginTop = "5px";
  element.style.marginRight = "5px";
  element.style.borderRadius = "0.375rem"; // Rounded-md
  element.style.backgroundColor = "rgb(79, 70, 229)"; // bg-indigo-600
  element.style.paddingLeft = "0.875rem"; //
  element.style.paddingRight = "0.875rem"; // 
  element.style.fontSize = "0.875rem"; // text-sm
  element.style.fontWeight = "600"; // font-semibold
  element.style.color = "white"; // text-white
  element.style.height = "40px";
  element.style.boxShadow = "0 2px 4px rgba(0, 0, 0, 0.1)"; // shadow-sm
  element.addEventListener("click", func);
  return element;
};

const experimentComponent = () => {
  var parent = document.createElement("div");
  const label = document.createElement("p");
  label.style.marginTop = "5px";
  label.innerText = "Inference Plugin";
  parent.appendChild(label);

  const form = document.createElement("form");
  form.id = "test";
  form.style.display = "flex"; // Enable Flexbox
  form.style.alignItems = "center"; // Center items horizontally
  form.addEventListener("submit", testInference);
  const input = document.createElement("input");
  input.style.borderRadius = "5px";
  input.style.borderColor = "#E5E7EB";
  input.style.marginTop = "5px";
  input.style.marginRight = "5px";
  input.name = "message";
  form.appendChild(input);
  const button = getButton("Test Inference", null);
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
