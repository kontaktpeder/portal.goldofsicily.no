-- Oslo Bar blir både serveringssted og direkte partner.
-- Stedet (customers) beholdes; vi oppretter en partner med kind = 'direct'
-- og kobler customer.partner_id dit — samme modell som «Opprett som handelspartner og serveringssted».
--
-- Customer id: 74289937-90e7-41fd-bf1b-3f0bce80ef1a
-- Kjør i Lovable Cloud → SQL / Supabase SQL Editor, FØR 05_rename_customers_to_venues.sql.
-- Trygg å kjøre flere ganger.

DO $$
DECLARE
  v_customer_id UUID := '74289937-90e7-41fd-bf1b-3f0bce80ef1a';
  v_name TEXT;
  v_contact TEXT;
  v_email TEXT;
  v_phone TEXT;
  v_current_partner UUID;
  v_partner_id UUID;
  v_partner_kind public.partner_kind;
  v_partner_venues INT;
BEGIN
  SELECT c.name, c.contact_name, c.email, c.phone, c.partner_id
  INTO v_name, v_contact, v_email, v_phone, v_current_partner
  FROM public.customers c
  WHERE c.id = v_customer_id;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Fant ikke sted med id %', v_customer_id;
  END IF;

  IF v_current_partner IS NOT NULL THEN
    SELECT p.kind,
           (SELECT count(*) FROM public.customers x WHERE x.partner_id = p.id)
    INTO v_partner_kind, v_partner_venues
    FROM public.partners p
    WHERE p.id = v_current_partner;
  END IF;

  -- Allerede egen direkte partner: bare sørg for at den er aktiv.
  IF v_current_partner IS NOT NULL
     AND v_partner_kind = 'direct'
     AND v_partner_venues = 1 THEN
    UPDATE public.partners
    SET
      active = true,
      name = v_name,
      contact_name = COALESCE(contact_name, v_contact),
      email = COALESCE(email, v_email),
      phone = COALESCE(phone, v_phone)
    WHERE id = v_current_partner;
    RAISE NOTICE 'Oslo Bar er allerede sted og direkte partner (%).', v_current_partner;
    RETURN;
  END IF;

  INSERT INTO public.partners (name, kind, active, contact_name, email, phone)
  VALUES (v_name, 'direct', true, v_contact, v_email, v_phone)
  RETURNING id INTO v_partner_id;

  UPDATE public.customers
  SET partner_id = v_partner_id
  WHERE id = v_customer_id;

  RAISE NOTICE 'Opprettet direkte partner % og koblet sted % (%).', v_partner_id, v_name, v_customer_id;
END;
$$;
