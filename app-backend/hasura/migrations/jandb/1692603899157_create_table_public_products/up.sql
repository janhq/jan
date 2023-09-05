CREATE TABLE "public"."products" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "slug" varchar NOT NULL, "name" text NOT NULL, "description" text, "image_url" text, "long_description" text, "technical_description" text, "author" text, "version" text, "source_url" text, "nsfw" boolean NOT NULL DEFAULT true, "greeting" text, "inputs" jsonb, "outputs" jsonb, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(), PRIMARY KEY ("id") , UNIQUE ("slug"));
CREATE OR REPLACE FUNCTION "public"."set_current_timestamp_updated_at"()
RETURNS TRIGGER AS $$
DECLARE
  _new record;
BEGIN
  _new := NEW;
  _new."updated_at" = NOW();
  RETURN _new;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "set_public_products_updated_at"
BEFORE UPDATE ON "public"."products"
FOR EACH ROW
EXECUTE PROCEDURE "public"."set_current_timestamp_updated_at"();
COMMENT ON TRIGGER "set_public_products_updated_at" ON "public"."products"
IS 'trigger to set value of column "updated_at" to current timestamp on row update';
CREATE EXTENSION IF NOT EXISTS pgcrypto;
