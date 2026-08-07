-- The outbox can now address a seller as well as a bidder.
--
-- Sellers are not Users — §11 keeps them a record an operator maintains
-- rather than an account anyone logs into — so the existing user_id
-- foreign key could not reach them, and the bid log the access design
-- promises after close had nowhere to go.

ALTER TABLE "sellers" ADD COLUMN "locale" "locale" NOT NULL DEFAULT 'bg';

ALTER TABLE "outbox" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "outbox" ADD COLUMN "seller_id" UUID;

ALTER TABLE "outbox"
  ADD CONSTRAINT "outbox_seller_id_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one recipient. A message with neither is undeliverable and one
-- with both is ambiguous about who it is for — and the dispatcher would
-- have to guess, which is how somebody eventually receives another
-- party's correspondence.
ALTER TABLE "outbox"
  ADD CONSTRAINT "outbox_one_recipient"
  CHECK (("user_id" IS NOT NULL) <> ("seller_id" IS NOT NULL));

CREATE INDEX "outbox_seller_id_idx" ON "outbox"("seller_id");
