ALTER TABLE app_listings ADD COLUMN IF NOT EXISTS public_slug text;
CREATE TABLE IF NOT EXISTS app_listing_slugs (
  slug text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS app_listing_slugs_project_idx ON app_listing_slugs(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS app_listings_public_slug_idx ON app_listings(public_slug);

-- Reserve legacy URLs before introducing names. Aliases remain bound to their
-- project and are readable only while its current listing passes public checks.
INSERT INTO app_listing_slugs(slug,project_id)
SELECT p.slug,p.id FROM projects p JOIN app_listings l ON l.project_id=p.id
ON CONFLICT DO NOTHING;

DO $$
DECLARE entry record; base text; candidate text; attempt integer; claimed text;
BEGIN
  FOR entry IN SELECT project_id,title FROM app_listings WHERE public_slug IS NULL ORDER BY first_listed_at NULLS LAST,project_id LOOP
    base := trim(both '-' from left(regexp_replace(lower(entry.title),'[^a-z0-9]+','-','g'),50));
    IF length(base)<3 OR base LIKE 'forge-%' OR base IN ('api','admin','new','edit','sitemap','opengraph-image') THEN base := 'my-app'; END IF;
    attempt := 0;
    LOOP
      candidate := CASE WHEN attempt=0 THEN base ELSE left(base,40)||'-'||left(md5(entry.project_id),8)||CASE WHEN attempt>1 THEN '-'||attempt::text ELSE '' END END;
      claimed := NULL;
      IF NOT EXISTS(SELECT 1 FROM projects WHERE slug=candidate AND id<>entry.project_id) THEN
        INSERT INTO app_listing_slugs(slug,project_id) VALUES(candidate,entry.project_id)
          ON CONFLICT(slug) DO NOTHING RETURNING project_id INTO claimed;
        IF claimed IS NOT NULL OR EXISTS(SELECT 1 FROM app_listing_slugs WHERE slug=candidate AND project_id=entry.project_id) THEN EXIT; END IF;
      END IF;
      attempt := attempt+1;
    END LOOP;
    UPDATE app_listings SET public_slug=candidate WHERE project_id=entry.project_id;
  END LOOP;
END $$;
