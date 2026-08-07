-- Invoices, and a gapless number to put on them.
--
-- The counter is a ROW and not a sequence, deliberately. nextval() is
-- not rolled back, so an aborted transaction burns a number — and
-- Bulgarian фактури must be numbered consecutively. "We skipped
-- 0000000042 because a database transaction failed" is not an answer
-- anyone wants to give an auditor.
--
-- The number is therefore taken under SELECT ... FOR UPDATE inside the
-- same transaction that writes the invoice. Roll back and the number is
-- not consumed. It serialises invoice creation, which is exactly right:
-- they have to be issued in order.

CREATE TYPE "invoice_status" AS ENUM ('issued', 'paid', 'cancelled');

CREATE TABLE "invoice_counters" (
  "series" TEXT NOT NULL,
  "next"   INTEGER NOT NULL DEFAULT 1,

  CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("series")
);

CREATE TABLE "invoices" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "number"         TEXT NOT NULL,
  "series"         TEXT NOT NULL,
  "status"         "invoice_status" NOT NULL DEFAULT 'issued',
  "seller_id"      UUID,
  "user_id"        UUID,
  -- Copied at issue, never joined at render time: an invoice records what
  -- was billed on a date, and must not change if the party later edits
  -- their address.
  "billed_name"    TEXT NOT NULL,
  "billed_address" TEXT,
  "billed_eik"     TEXT,
  "billed_vat"     TEXT,
  "net_minor"      BIGINT NOT NULL,
  "vat_minor"      BIGINT NOT NULL,
  "issued_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paid_at"        TIMESTAMPTZ(6),
  "note"           TEXT,

  CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");
CREATE INDEX "invoices_status_issued_at_idx" ON "invoices"("status", "issued_at");

-- Exactly one party, like the fees the invoice covers.
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_one_party"
  CHECK (("seller_id" IS NOT NULL) <> ("user_id" IS NOT NULL));

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_seller_id_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fees" ADD COLUMN "invoice_id" UUID;

ALTER TABLE "fees"
  ADD CONSTRAINT "fees_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The current year, so numbering restarts naturally each January.
INSERT INTO "invoice_counters" ("series", "next")
VALUES (to_char(CURRENT_DATE, 'YYYY'), 1)
ON CONFLICT DO NOTHING;
