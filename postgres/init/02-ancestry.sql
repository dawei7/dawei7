-- Ancestry app schema
-- This file runs automatically when the postgres container first starts.
-- For existing deployments, run manually:
--   psql $DATABASE_URL -f postgres/init/02-ancestry.sql

\c dawei_db;

-- Extensions are already enabled in 01-init.sql (uuid-ossp, pg_trgm, citext)

CREATE TABLE IF NOT EXISTS persons (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    gedcom_id   TEXT        UNIQUE,
    first_name  CITEXT,
    last_name   CITEXT,
    maiden_name CITEXT,
    sex         CHAR(1)     CHECK (sex IN ('M', 'F', 'U')),
    birth_date  TEXT,
    birth_place TEXT,
    death_date  TEXT,
    death_place TEXT,
    notes       TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Fast name search (used by the /api/people endpoint)
CREATE INDEX IF NOT EXISTS idx_persons_first ON persons USING btree (first_name);
CREATE INDEX IF NOT EXISTS idx_persons_last  ON persons USING btree (last_name);

CREATE TABLE IF NOT EXISTS families (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gedcom_id      TEXT UNIQUE,
    husband_id     UUID REFERENCES persons(id),
    wife_id        UUID REFERENCES persons(id),
    marriage_date  TEXT,
    marriage_place TEXT
);

CREATE TABLE IF NOT EXISTS family_children (
    family_id  UUID REFERENCES families(id) ON DELETE CASCADE,
    person_id  UUID REFERENCES persons(id)  ON DELETE CASCADE,
    PRIMARY KEY (family_id, person_id)
);
