SET check_function_bodies = false;

INSERT INTO public.collection_products (collection_id, product_id)
SELECT (SELECT id FROM public.collections WHERE slug = 'conversational') AS collection_id, id AS product_id
FROM public.products
WHERE slug IN ('llama2');

INSERT INTO public.collection_products (collection_id, product_id)
SELECT (SELECT id FROM public.collections WHERE slug = 'text-to-image') AS collection_id, id AS product_id
FROM public.products
WHERE slug IN ('stablediffusion');