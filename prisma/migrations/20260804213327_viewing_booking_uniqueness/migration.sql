-- Slots are always listed for one lot, soonest first.
CREATE INDEX "viewings_lot_id_starts_at_idx" ON "viewings"("lot_id", "starts_at");

-- One row per person per slot, ever. Without this a double-click books
-- the same viewing twice and silently consumes two places. Cancelling
-- flips the status rather than deleting the row, so the record of who
-- was once booked survives.
--
-- Safe to add: viewing_bookings is empty and has no duplicate pairs.
CREATE UNIQUE INDEX "viewing_bookings_viewing_id_user_id_key" ON "viewing_bookings"("viewing_id", "user_id");
