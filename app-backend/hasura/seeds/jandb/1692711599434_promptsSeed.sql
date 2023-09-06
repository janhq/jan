SET check_function_bodies = false;
INSERT INTO public.prompts ("slug", "content", "image_url") VALUES
('conversational-ai-future', 'What are possible developments for AI technology in the next decade?', ''),
('conversational-managing-stress', 'What are some tips for managing stress?', ''),
('conversational-postapoc-robot', 'Let''s role play. You are a robot in a post-apocalyptic world.', ''),
('conversational-python-pytorch', 'What is the difference between Python and Pytorch?', ''),
('conversational-quadratic-equation', 'Can you explain how to solve a quadratic equation?', ''),
('conversational-roman-history', 'What is the history of the Roman Empire?', '')
ON CONFLICT (slug) DO NOTHING;
