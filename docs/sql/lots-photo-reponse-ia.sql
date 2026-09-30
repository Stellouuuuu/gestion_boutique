-- TEST puis PROD (après OK) : une transaction, ADD COLUMN seulement.
-- Réponse brute IA pour rejeu sans nouvel appel Gemini.
begin;

alter table lots_photo
  add column if not exists reponse_ia jsonb;

commit;
