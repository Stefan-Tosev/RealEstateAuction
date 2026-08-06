-- Sellers.
--
-- Whose property it is. §11 keeps lot sourcing admin-curated, so this is
-- a record an operator maintains, not an account anyone logs into.
--
-- Personal data: never selected into a public payload. The protection is
-- structural, in src/server/catalogue/select.ts, the same way the reserve
-- price is kept out.

CREATE TYPE "seller_kind" AS ENUM ('individual', 'company');

CREATE TABLE "sellers" (
  "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
  "kind"       "seller_kind" NOT NULL DEFAULT 'individual',
  "name"       TEXT NOT NULL,
  "email"      TEXT,
  "phone"      TEXT,
  "eik"        TEXT,
  "vat"        TEXT,
  "address"    TEXT,
  "notes"      TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sellers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sellers_name_idx" ON "sellers"("name");

-- Nullable: a property can be drafted before the seller paperwork exists.
-- publishBlockers() is what refuses to put it live without one.
ALTER TABLE "properties" ADD COLUMN "seller_id" UUID;

ALTER TABLE "properties"
  ADD CONSTRAINT "properties_seller_id_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "properties_seller_id_idx" ON "properties"("seller_id");

-- A seller fee now has somebody to point at. Restrictive, like the lot
-- reference: a billing record must not lose its counterparty silently.
ALTER TABLE "fees" ADD COLUMN "seller_id" UUID;

ALTER TABLE "fees"
  ADD CONSTRAINT "fees_seller_id_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
