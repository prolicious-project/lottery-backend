CREATE OR REPLACE FUNCTION prevent_completed_at_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.completed_at IS NOT NULL AND NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
    RAISE EXCEPTION 'completed_at cannot be modified once set';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prevent_completed_at_update ON level_pools;

CREATE TRIGGER trigger_prevent_completed_at_update
BEFORE UPDATE ON level_pools
FOR EACH ROW
EXECUTE FUNCTION prevent_completed_at_update();
