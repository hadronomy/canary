CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS set_timestamp_legislative_sources ON legislative_sources;--> statement-breakpoint
CREATE TRIGGER set_timestamp_legislative_sources
  BEFORE UPDATE ON legislative_sources
  FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();--> statement-breakpoint

DROP TRIGGER IF EXISTS set_timestamp_legal_documents ON legal_documents;--> statement-breakpoint
CREATE TRIGGER set_timestamp_legal_documents
  BEFORE UPDATE ON legal_documents
  FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();--> statement-breakpoint

DROP TRIGGER IF EXISTS set_timestamp_sense_fragments ON sense_fragments;--> statement-breakpoint
CREATE TRIGGER set_timestamp_sense_fragments
  BEFORE UPDATE ON sense_fragments
  FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();--> statement-breakpoint

CREATE OR REPLACE FUNCTION normalize_spanish_text(input_text TEXT)
RETURNS TEXT AS $$
BEGIN
  IF input_text IS NULL THEN RETURN NULL; END IF;
  RETURN lower(unaccent(input_text));
END;
$$ LANGUAGE plpgsql IMMUTABLE;--> statement-breakpoint

CREATE OR REPLACE FUNCTION trigger_normalize_content()
RETURNS TRIGGER AS $$
BEGIN
  NEW.content_normalized = normalize_spanish_text(NEW.content);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS normalize_fragment_content ON sense_fragments;--> statement-breakpoint
CREATE TRIGGER normalize_fragment_content
  BEFORE INSERT OR UPDATE ON sense_fragments
  FOR EACH ROW EXECUTE FUNCTION trigger_normalize_content();--> statement-breakpoint

CREATE OR REPLACE FUNCTION trigger_calculate_metrics()
RETURNS TRIGGER AS $$
DECLARE
  word_count INT;
BEGIN
  NEW.char_count = length(NEW.content);
  word_count := array_length(regexp_split_to_array(trim(NEW.content), '\s+'), 1);
  IF word_count IS NULL THEN word_count := 0; END IF;
  NEW.word_count = word_count;
  NEW.token_count = (word_count * 1.3)::INT;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS calculate_fragment_metrics ON sense_fragments;--> statement-breakpoint
CREATE TRIGGER calculate_fragment_metrics
  BEFORE INSERT OR UPDATE ON sense_fragments
  FOR EACH ROW EXECUTE FUNCTION trigger_calculate_metrics();--> statement-breakpoint

CREATE OR REPLACE FUNCTION trigger_compute_legislative_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.repealed_at IS NOT NULL AND NEW.repealed_at <= CURRENT_TIMESTAMP THEN
    NEW.legislative_stage = 'repealed';
  ELSIF NEW.published_at IS NOT NULL AND NEW.entry_into_force_at IS NOT NULL THEN
    NEW.legislative_stage = 'enacted';
  ELSIF NEW.approved_at IS NOT NULL THEN
    NEW.legislative_stage = 'approved';
  ELSIF NEW.parent_bulletin_id IS NOT NULL THEN
    NEW.legislative_stage = 'bulletin';
  ELSIF NEW.debated_at IS NOT NULL OR NEW.procedural_status IS NOT NULL THEN
    NEW.legislative_stage = 'parliamentary';
  ELSE
    NEW.legislative_stage = 'draft';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS compute_legislative_status ON legal_documents;--> statement-breakpoint
CREATE TRIGGER compute_legislative_status
  BEFORE INSERT OR UPDATE ON legal_documents
  FOR EACH ROW EXECUTE FUNCTION trigger_compute_legislative_status();--> statement-breakpoint

CREATE OR REPLACE FUNCTION trigger_prevent_validated_deletion()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.validated_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot delete validated reference %', OLD.anchor_id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS prevent_validated_ref_delete ON reference_anchors;--> statement-breakpoint
CREATE TRIGGER prevent_validated_ref_delete
  BEFORE DELETE ON reference_anchors
  FOR EACH ROW EXECUTE FUNCTION trigger_prevent_validated_deletion();
