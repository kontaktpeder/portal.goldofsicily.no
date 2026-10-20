-- Kjør i Lovable Cloud → SQL etter sql/29.
-- order_invoice_lines leser d.payment_due_on. Kolonnen ligger i sql/20,
-- men ble ikke med da sql/29 la inn transfer_status og dnb-feltene.
-- De andre kolonnene funksjonen leser på invoice_drafts finnes allerede
-- (sql/17 og sql/29). Funksjonen bruker dynamisk SQL, så kolonnen er nok.
-- Eksisterende fakturautkast, leveranser og kunder endres ikke.
-- Also applied as supabase/migrations/20261020230000_invoice_payment_due.sql.

ALTER TABLE public.invoice_drafts
  ADD COLUMN IF NOT EXISTS payment_due_on DATE;

SELECT
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invoice_drafts'
      AND column_name = 'payment_due_on'
  ) AS payment_due_on_column;
