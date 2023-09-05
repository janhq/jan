alter table "public"."collection_products"
  add constraint "collection_products_product_id_fkey"
  foreign key ("product_id")
  references "public"."products"
  ("id") on update cascade on delete cascade;
