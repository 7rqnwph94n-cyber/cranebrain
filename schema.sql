-- D1 schema, inferred from the queries in src/worker.js
CREATE TABLE IF NOT EXISTS docs (
  owner      TEXT    NOT NULL,          -- Cloudflare Access email
  col        TEXT    NOT NULL,          -- e.g. svc/reports, rw/jobs
  id         TEXT    NOT NULL,
  data       TEXT    NOT NULL,          -- JSON document
  updated_at INTEGER NOT NULL,          -- ms epoch, last write wins
  deleted    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner, col, id)
);
