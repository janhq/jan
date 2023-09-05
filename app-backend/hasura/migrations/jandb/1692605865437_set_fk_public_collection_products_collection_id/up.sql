alter table "public"."collection_products"
  add constraint "collection_products_collection_id_fkey"
  foreign key ("collection_id")
  references "public"."collections"
  ("id") on update cascade on delete cascade;
