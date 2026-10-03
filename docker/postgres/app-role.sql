-- The app connects as a role that row-level security applies to: it owns the
-- database and its schemas, but is never a superuser and never bypasses RLS.
CREATE ROLE omnitech LOGIN PASSWORD 'omnitech' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE omnitech OWNER omnitech;
