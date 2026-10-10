CREATE TABLE model_config_clock (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  revision INTEGER NOT NULL
);

INSERT INTO model_config_clock (id, revision)
SELECT 1, COALESCE(MAX(revision), 0) FROM model_config_scopes;
