-- Runs once when the Docker Postgres volume is first created.
-- The e2e suite TRUNCATEs this database between tests, so it must be separate
-- from the development database.
CREATE DATABASE ops_erp_test;
