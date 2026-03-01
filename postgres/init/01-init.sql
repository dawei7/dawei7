-- PostgreSQL initialization script
-- This runs automatically when the postgres container first starts
-- Add one CREATE DATABASE per app that needs its own database

-- Personal website DB (if needed)
-- CREATE DATABASE personal_website;

-- Example: Create a database for each app
-- CREATE DATABASE myapp;
-- GRANT ALL PRIVILEGES ON DATABASE myapp TO dawei;

-- Enable useful extensions in the default DB
\c dawei_db;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";    -- UUID generation
CREATE EXTENSION IF NOT EXISTS "pg_trgm";      -- Fuzzy text search
CREATE EXTENSION IF NOT EXISTS "citext";       -- Case-insensitive text type
