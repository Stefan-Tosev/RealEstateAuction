-- Fees: split the blended amount into net and ДДС, and record the rates.
--
-- A Bulgarian invoice shows base and ДДС as two lines, the statutory rate
-- changes, and a business below the registration threshold charges none
-- at all. A row carrying only a gross figure cannot reconstruct any of
-- that afterwards.
--
-- Written by hand because amount_minor is RENAMED, not replaced. Prisma
-- reads a rename as a drop plus an add, which would be a silent data loss
-- on a table that will hold the billing record.

ALTER TABLE "fees" RENAME COLUMN "amount_minor" TO "net_minor";

-- The money collected for НАП. Not revenue: it passes straight through.
ALTER TABLE "fees" ADD COLUMN "vat_minor" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "fees" ADD COLUMN "vat_rate" DECIMAL(6,4);

-- What the percentage was taken of — the hammer price. Null for a fixed fee.
ALTER TABLE "fees" ADD COLUMN "base_minor" BIGINT;

-- Who owes it, where we have a record. Null for seller fees until sellers
-- are modelled; the lot identifies the property either way.
ALTER TABLE "fees" ADD COLUMN "user_id" UUID;
ALTER TABLE "fees" ADD COLUMN "note" TEXT;

ALTER TABLE "fees"
  ADD CONSTRAINT "fees_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One fee of each kind per party per lot. Raising a second commission
-- because a close ran twice is a billing error, not a retry.
CREATE UNIQUE INDEX "fees_lot_id_party_kind_key" ON "fees"("lot_id", "party", "kind");

CREATE INDEX "fees_status_charged_at_idx" ON "fees"("status", "charged_at");
