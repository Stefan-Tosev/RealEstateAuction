-- Enforce append-only at the database level (docs/architecture.md §3):
-- "Enforce append-only at the database level with a trigger, not by
-- convention." Application code must only ever INSERT into bids.

CREATE OR REPLACE FUNCTION bids_prevent_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'bids is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bids_append_only
  BEFORE UPDATE OR DELETE ON "bids"
  FOR EACH ROW EXECUTE FUNCTION bids_prevent_mutation();
