INSERT INTO public.collections ("slug", "name", "description") VALUES
('conversational', 'Conversational', 'Converse with these models and get answers.')
ON CONFLICT (slug) DO NOTHING;
