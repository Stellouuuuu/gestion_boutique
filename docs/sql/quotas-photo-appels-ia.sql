-- Additive : compteur d’appels IA / jour / boutique + lecture membre
-- DROP policy uniquement sur quotas_photo. Une transaction.
begin;

alter table quotas_photo add column if not exists nb_appels_ia integer not null default 0;

drop policy if exists qp_lire on quotas_photo;
create policy qp_lire on quotas_photo for select using (est_membre(boutique_id));
-- Écriture réservée au service role (Edge Function) : pas de policy insert/update pour authenticated.

commit;
