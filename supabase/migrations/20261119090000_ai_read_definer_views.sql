-- Repair databases that already recreated these ai_read views as
-- security-invoker in 20261105010000_mark_legacy_delivery.sql.
-- ai_readonly is intentionally granted only the curated ai_read views, not the
-- underlying public tables, so these views must run with owner privileges.

ALTER VIEW ai_read.deliveries SET (security_invoker = false);
ALTER VIEW ai_read.delivery_totals SET (security_invoker = false);
ALTER VIEW ai_read.data_quality SET (security_invoker = false);
ALTER VIEW ai_read.accounting_discrepancies SET (security_invoker = false);
ALTER VIEW ai_read.kpis SET (security_invoker = false);
