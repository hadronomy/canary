CREATE OR REPLACE FUNCTION generate_uuid_v7()
RETURNS UUID AS $$
DECLARE
  unix_ts_ms BIGINT;
  uuid_bytes BYTEA;
BEGIN
  unix_ts_ms := (EXTRACT(EPOCH FROM CLOCK_TIMESTAMP()) * 1000)::BIGINT;
  uuid_bytes := gen_random_bytes(16);

  uuid_bytes := SET_BYTE(uuid_bytes, 0, ((unix_ts_ms >> 40) & 255)::INT);
  uuid_bytes := SET_BYTE(uuid_bytes, 1, ((unix_ts_ms >> 32) & 255)::INT);
  uuid_bytes := SET_BYTE(uuid_bytes, 2, ((unix_ts_ms >> 24) & 255)::INT);
  uuid_bytes := SET_BYTE(uuid_bytes, 3, ((unix_ts_ms >> 16) & 255)::INT);
  uuid_bytes := SET_BYTE(uuid_bytes, 4, ((unix_ts_ms >> 8) & 255)::INT);
  uuid_bytes := SET_BYTE(uuid_bytes, 5, (unix_ts_ms & 255)::INT);
  uuid_bytes := SET_BYTE(uuid_bytes, 6, (GET_BYTE(uuid_bytes, 6) & 15) | 112);
  uuid_bytes := SET_BYTE(uuid_bytes, 8, (GET_BYTE(uuid_bytes, 8) & 63) | 128);

  RETURN ENCODE(uuid_bytes, 'hex')::UUID;
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE OR REPLACE FUNCTION generate_nanoid(size INT DEFAULT 21)
RETURNS TEXT AS $$
DECLARE
  alphabet TEXT := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
  id TEXT := '';
  i INT := 0;
  bytes BYTEA;
  byte INT;
  pos INT;
BEGIN
  WHILE i < size LOOP
    bytes := gen_random_bytes(1);
    byte := GET_BYTE(bytes, 0);
    pos := (byte & 63);
    IF pos < 64 THEN
      id := id || SUBSTRING(alphabet FROM pos + 1 FOR 1);
      i := i + 1;
    END IF;
  END LOOP;
  RETURN id;
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE OR REPLACE FUNCTION generate_ulid()
RETURNS TEXT AS $$
DECLARE
  timestamp_ms BIGINT;
  time_chars TEXT := '';
  rand_chars TEXT := '';
  alphabet TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  i INT;
  bytes BYTEA;
  byte INT;
  char_idx INT;
BEGIN
  timestamp_ms := (EXTRACT(EPOCH FROM CLOCK_TIMESTAMP()) * 1000)::BIGINT;

  FOR i IN 0..9 LOOP
    char_idx := (timestamp_ms >> (45 - i * 5)) & 31;
    time_chars := time_chars || SUBSTRING(alphabet FROM char_idx + 1 FOR 1);
  END LOOP;

  bytes := gen_random_bytes(10);
  FOR i IN 0..9 LOOP
    byte := GET_BYTE(bytes, i);
    char_idx := (byte >> 3) & 31;
    rand_chars := rand_chars || SUBSTRING(alphabet FROM char_idx + 1 FOR 1);
    char_idx := ((byte & 7) << 2) | (CASE WHEN i < 9 THEN (GET_BYTE(bytes, i+1) >> 6) & 3 ELSE 0 END);
    rand_chars := rand_chars || SUBSTRING(alphabet FROM char_idx + 1 FOR 1);
  END LOOP;

  RETURN time_chars || SUBSTRING(rand_chars FROM 1 FOR 16);
END;
$$ LANGUAGE plpgsql VOLATILE;
