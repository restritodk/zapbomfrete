-- Additive: interactive consent buttons on DatafyCampaign (freeform / Envio Direto).
ALTER TABLE "DatafyCampaign"
  ADD COLUMN IF NOT EXISTS "interactiveButtons" JSONB;
