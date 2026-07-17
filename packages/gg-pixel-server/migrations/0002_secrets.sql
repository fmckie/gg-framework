-- Adds the per-project bearer secret used to authenticate every /api/* call.
--
-- Existing rows are left with a NULL secret on purpose: those projects can
-- still receive /ingest events (matched by `key`), but they cannot be
-- managed via the API until they are re-minted via `kleio-coder pixel install`.
-- Re-running install detects the missing secret in ~/.gg/projects.json and
-- creates a fresh project_id+key+secret triple for that directory.

ALTER TABLE projects ADD COLUMN secret TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS projects_secret ON projects(secret);
