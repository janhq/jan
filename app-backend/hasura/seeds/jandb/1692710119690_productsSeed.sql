SET check_function_bodies = false;
INSERT INTO public.products ("slug", "name", "nsfw", "image_url", "description", "long_description", "technical_description", "author", "version", "source_url", "inputs", "outputs", "greeting") VALUES
('jangpt', 'JanGPT', 't', 'https://cloud.jan.ai/icons/app_icon.svg','', '', '', '', '', '', '{"body": [{"name": "messages", "type": "array", "items": [{"type": "object", "properties": [{"name": "role", "type": "string", "example": "system", "description": "Defines the role of the message."}, {"name": "content", "type": "string", "example": "Hello, world!", "description": "Contains the content of the message."}]}], "description": "An array of messages, each containing a role and content. The latest message is always at the end of the array."}, {"name": "stream", "type": "boolean", "example": true, "description": "Indicates whether the client wants to keep the connection open for streaming."}, {"name": "max_tokens", "type": "integer", "example": 500, "description": "Defines the maximum number of tokens that the client wants to receive."}], "slug": "llm", "headers": {"accept": "text/event-stream", "content-type": "application/json"}}', '{"slug": "llm", "type": "object", "properties": [{"name": "id", "type": "string", "example": "chatcmpl-4c4e5eb5-bf53-4dbc-9136-1cf69fc5fd7c", "description": "The unique identifier of the chat completion chunk."}, {"name": "model", "type": "string", "example": "gpt-3.5-turbo", "description": "The name of the GPT model used to generate the completion."}, {"name": "created", "type": "integer", "example": 1692169988, "description": "The Unix timestamp representing the time when the completion was generated."}, {"name": "object", "type": "string", "example": "chat.completion.chunk", "description": "A string indicating the type of the chat completion chunk."}, {"name": "choices", "type": "array", "items": [{"type": "object", "properties": [{"name": "index", "type": "integer", "example": 0, "description": "The index of the choice made by the GPT model."}, {"name": "delta", "type": "object", "properties": [{"name": "content", "type": "string", "example": "What", "description": "The content generated by the GPT model."}], "description": "A JSON object containing the content generated by the GPT model."}, {"name": "finish_reason", "type": "string", "example": null, "description": "A string indicating why the GPT model stopped generating content."}]}], "description": "An array containing the choices made by the GPT model to generate the completion."}], "description": "A JSON object representing a chat completion chunk."}', '👋I’m a versatile AI trained on a wide range of topics, here to answer your questions about the universe. What are you curious about today?')
ON CONFLICT (slug) DO NOTHING;
