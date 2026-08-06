-- AlterTable
ALTER TABLE "lots" ADD COLUMN     "negotiation_ends_at" TIMESTAMPTZ(6),
ADD COLUMN     "negotiation_hours" INTEGER NOT NULL DEFAULT 48;

-- CreateIndex
CREATE INDEX "lots_status_negotiation_ends_at_idx" ON "lots"("status", "negotiation_ends_at");
