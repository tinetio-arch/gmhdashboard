-- Migration: Fix total_amount column precision from numeric(12,2) to numeric(12,3)
-- This matches the other volume columns and prevents silent truncation of 3-decimal values

ALTER TABLE dispenses
  ALTER COLUMN total_amount TYPE numeric(12,3);
