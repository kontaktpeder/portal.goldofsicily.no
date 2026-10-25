-- Kjør i Lovable Cloud → SQL etter sql/15_lot_events.sql.
-- Lar portalen logge at et lukket LOT ble åpnet igjen.
-- Selve statusendringen virker uten denne filen. Hendelsen «åpnet igjen» krever den.

ALTER TYPE public.gold_lot_event_type ADD VALUE IF NOT EXISTS 'reopened';
