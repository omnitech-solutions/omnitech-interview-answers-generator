-- Baseline. These objects are created by the legacy SQL migrations
-- (packages/platform-storage/migrations 0001–0011 and the assistant's), which
-- always run first. Drizzle records this migration by name: on the dev
-- database `pull --init` already did; on a fresh database this no-op records it.
SELECT 1;
