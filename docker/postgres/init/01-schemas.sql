-- Logical isolation placeholders (database-per-service later).
-- Phase 0: single DB with schemas reserved for future services.
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS post;
CREATE SCHEMA IF NOT EXISTS graph;
CREATE SCHEMA IF NOT EXISTS notification;
