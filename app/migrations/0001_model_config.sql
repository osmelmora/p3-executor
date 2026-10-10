CREATE TABLE model_config_scopes (
  scope_key TEXT PRIMARY KEY NOT NULL,
  project TEXT,
  document TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (scope_key = 'global' AND project IS NULL)
    OR (project IS NOT NULL AND scope_key = 'project:' || project)
  )
);
