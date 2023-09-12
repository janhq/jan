import { OpenAI } from "openai-streams";

export async function POST(req: Request) {
  const { messages } = await req.json();
  if (!messages) {
    return new Response(null, {
      status: 400,
      statusText: "Did not include `messages` parameter",
    });
  }
  const completionsStream = await OpenAI(
    "chat",
    {
      model: "gpt-3.5-turbo",
      stream: true,
      messages,
      max_tokens: 500,
    },
    {
      apiBase: process.env.OPENAPI_ENDPOINT,
      apiKey: process.env.OPENAPI_KEY,
    }
  );

  return new Response(completionsStream);
}
