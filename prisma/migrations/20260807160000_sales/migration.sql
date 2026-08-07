-- Sales: everything between "you won" and the keys.
--
-- The system stopped at the winning bid. The buyer got an email and the
-- whole completion — contract, balance, notary, keys — lived on paper,
-- with no way to answer "which sales are outstanding and what is each
-- waiting on".
--
-- Milestones are timestamps rather than a status column something has to
-- remember to advance. Each is a fact with a date; status is derived, so
-- the two cannot disagree.

CREATE TABLE "sales" (
  "id"                 UUID NOT NULL,
  -- One sale per lot. A second would mean the lot sold twice.
  "lot_id"             UUID NOT NULL,
  "user_id"            UUID NOT NULL,
  -- The hammer price. The buyer's premium is billed separately on its own
  -- invoice: it is the auction house's fee, not part of the price agreed
  -- for the property.
  "hammer_minor"       BIGINT NOT NULL,
  -- Already held, and counting toward the price — which is what it was
  -- taken for.
  "deposit_minor"      BIGINT NOT NULL DEFAULT 0,
  "completion_due_at"  TIMESTAMPTZ(6) NOT NULL,
  "contract_signed_at" TIMESTAMPTZ(6),
  "balance_paid_at"    TIMESTAMPTZ(6),
  -- The нотариален акт signed before a notary. This is the transfer.
  "completed_at"       TIMESTAMPTZ(6),
  "defaulted_at"       TIMESTAMPTZ(6),
  "notes"              TEXT,
  "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sales_lot_id_key" ON "sales"("lot_id");

-- The operations question: what is outstanding, and what is overdue.
CREATE INDEX "sales_completed_at_completion_due_at_idx"
  ON "sales"("completed_at", "completion_due_at");

ALTER TABLE "sales"
  ADD CONSTRAINT "sales_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales"
  ADD CONSTRAINT "sales_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A sale cannot be both completed and defaulted. It is one or the other,
-- and a row claiming both is a bug nobody would notice from a dashboard.
ALTER TABLE "sales"
  ADD CONSTRAINT "sales_not_both_outcomes"
  CHECK ("completed_at" IS NULL OR "defaulted_at" IS NULL);
