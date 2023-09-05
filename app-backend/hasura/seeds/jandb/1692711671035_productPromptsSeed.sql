SET check_function_bodies = false;

INSERT INTO public.product_prompts (product_id, prompt_id)
SELECT p.id AS product_id, r.id AS prompt_id
FROM public.products p 
JOIN public.prompts r 
ON (p.id 
     IN (SELECT x.id FROM public.products x INNER JOIN public.collection_products y ON x.id = y.product_id 
                                            INNER JOIN public.collections z ON y.collection_id = z.id 
                    WHERE z.slug = 'text-to-image'))
WHERE r.image_url IS NOT NULL AND r.image_url != '';

INSERT INTO public.product_prompts (product_id, prompt_id)
SELECT p.id AS product_id, r.id AS prompt_id
FROM public.products p 
JOIN public.prompts r 
ON (p.id 
     IN (SELECT x.id FROM public.products x INNER JOIN public.collection_products y ON x.id = y.product_id 
                                            INNER JOIN public.collections z ON y.collection_id = z.id 
                    WHERE z.slug = 'conversational'))
WHERE r.image_url IS NULL OR r.image_url = '';