export const controlNetRequest = async (
  token: string,
  prompt: string,
  negPrompt: string,
  fileInput: any
): Promise<Record<string, unknown> | undefined> => {
  const formData = new FormData();

  const advancedPrompt: AdvancedPrompt = {
    prompt: prompt,
    neg_prompt: negPrompt ?? "",
    control_net_model: "controlnet_canny",
    seed: 1024,
    steps: 20,
    control_scale: 1.0,
  };

  formData.append("file", fileInput);
  formData.append("data", JSON.stringify(advancedPrompt));

  const res = await fetch("https://sd-inference.jan.ai/controlnet_inference", {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    console.error("fetchConversations error", res);
    return;
  }
  const body = await res.json();

  return body.url;
};

export type AdvancedPrompt = {
  prompt: string;
  neg_prompt: string;
  control_net_model: string;
  seed: number;
  steps: number;
  control_scale: number;
};
