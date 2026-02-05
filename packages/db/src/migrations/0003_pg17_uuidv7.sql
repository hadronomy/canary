CREATE OR REPLACE FUNCTION generate_uuid_v7()
RETURNS UUID AS $$
BEGIN
  RETURN gen_random_uuid_v7();
END;
$$ LANGUAGE plpgsql VOLATILE;
