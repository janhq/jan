INSERT INTO public.collections ("slug", "name", "description") VALUES
('conversational', 'Conversational', 'Chatbot alternatives to ChatGPT. Converse with these models and get answers.')
ON CONFLICT (slug) DO NOTHING;
