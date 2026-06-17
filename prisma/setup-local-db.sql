-- One-time setup for using an EXISTING local PostgreSQL (no Docker).
-- Run as a superuser, e.g. (Windows):
--   & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -f prisma/setup-local-db.sql
-- This creates a role + database that match the default DATABASE_URL in .env.example.

CREATE ROLE reloop WITH LOGIN PASSWORD 'reloop';
CREATE DATABASE reloop OWNER reloop;
GRANT ALL PRIVILEGES ON DATABASE reloop TO reloop;
