SET check_function_bodies = false;
INSERT INTO public.prompts ("slug", "content", "image_url") VALUES
('conversational-ai-future', 'What are possible developments for AI technology in the next decade?', ''),
('conversational-managing-stress', 'What are some tips for managing stress?', ''),
('conversational-postapoc-robot', 'Let''s role play. You are a robot in a post-apocalyptic world.', ''),
('conversational-python-pytorch', 'What is the difference between Python and Pytorch?', ''),
('conversational-quadratic-equation', 'Can you explain how to solve a quadratic equation?', ''),
('conversational-roman-history', 'What is the history of the Roman Empire?', ''),
('openjourney-1girl-gothic-lolita', '(masterpiece, top quality, best, official art, beautiful and aesthetic:1. 2), 1girl, (pop art:1. 4), (zentangle, flower effects:1. 2), (art nouveau:1. 1), (Gothic Lolita:1. 3)', 'https://static-assets.jan.ai/openjourney-2.jpeg'),
('openjourney-female-robot-rust', 'old, female robot, metal, rust, wisible wires, destroyed, sad, dark, dirty, looking at viewer, portrait, photography, detailed skin, realistic, photo-realistic, 8k, highly detailed, full length frame, High detail RAW color art, piercing, diffused soft lighting, shallow depth of field, sharp focus, hyperrealism, cinematic lighting', 'https://static-assets.jan.ai/openjourney-3.jpeg'),
('openjourney-ginger-cat', 'full body fluffy ginger cat with blue eyes by studio ghibli, makoto shinkai, by artgerm, by wlop, by greg rutkowski, volumetric lighting, octane render, 4 k resolution, trending on artstation, masterpiece', 'https://static-assets.jan.ai/openjourney-0.jpg'),
('openjourney-human-face-paint', 'FluidArt, human face covered in paint, photoshoot pose, portrait, dramatic, tri-color, long sleeved  frilly victorian dress made of thick dripping paint, rich thick cords of paint, medusa paint hair, appendages and legs transform into thick dripping paint, wide-zoom shot, hair metamorphosis into thick paint', 'https://static-assets.jan.ai/openjourney-4.jpeg'),
('openjourney-pocahontas', 'mdjrny-v4 style portrait photograph of Madison Beer as Pocahontas, young beautiful native american woman, perfect symmetrical face, feather jewelry, traditional handmade dress, armed female hunter warrior, (((wild west))) environment, Utah landscape, ultra realistic, concept art, elegant, ((intricate)), ((highly detailed)), depth of field, ((professionally color graded)), 8k, art by artgerm and greg rutkowski and alphonse mucha', 'https://static-assets.jan.ai/openjourney-1.jpeg'),
('text2image-gray-dog-eyes', 'realistic portrait of an gray dog, bright eyes, radiant and ethereal intricately detailed photography, cinematic lighting, 50mm lens with bokeh', 'https://static-assets.jan.ai/openjourney-7.jpeg'),
('text2image-ogre-exoskeleton', 'mdjrny-v4 style OGRE is wearing a powered exoskeleton , long horn, , cute face, tsutomu nihei style, Claude Monet, banksy art, 8K, Highly Detailed, Dramatic Lighting, high quality, ray of god, explosion, lens flare, beautiful detailed sky, cinematic lighting, overexposure, quality, colorful, hdr, concept design, photorealistic, hyper real, Alphonse Mucha, Pixar, cyberpunk 2077, masterpiece, the best quality, super fine illustrations, beatiful detailed cyberpunk city, extremely detailed eyes and face, beatiful detailed hair, wavy hair,beatiful detailed steet,mecha clothes, robot girl, bodysuit, very delicate light, fine lighting, very fine 8KCG wallpapers, plateau, sunrise, overexposure, randomly distributed clouds, cliff, rotating star sky, lake in mountain stream, luminous particles , Unreal Engine5, 8K', 'https://static-assets.jan.ai/openjourney-6.jpeg'),
('text2image-pablo-picasso', 'a young caucasian man holding his chin.pablo picasso style, acrylic painting, trending on pixiv fanbox, palette knife and brush. strokes,', 'https://static-assets.jan.ai/openjourney-5.jpeg')
ON CONFLICT (slug) DO NOTHING;
