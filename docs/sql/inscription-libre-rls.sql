-- Inscription libre + édition des noms (à exécuter dans l’éditeur SQL Supabase).
-- Idempotent : safe à rejouer.

-- 0) pgcrypto requis par creer_boutique (gen_random_bytes)
create extension if not exists pgcrypto;

-- 0b) Recréer creer_boutique (codes invitation) avec gen_random_bytes disponible
create or replace function creer_boutique(p_nom_boutique text, p_mon_nom text) returns uuid
language plpgsql security definer set search_path = public as $$
declare b uuid; c text;
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  if length(trim(p_nom_boutique)) < 1 then raise exception 'nom_boutique_requis'; end if;
  if length(trim(p_mon_nom)) < 1 then raise exception 'nom_requis'; end if;
  loop
    c := upper(substr(translate(encode(gen_random_bytes(8), 'base64'), '+/=01OoIiLl', ''), 1, 6));
    exit when length(c) = 6 and not exists (select 1 from boutiques where code_invitation = c);
  end loop;
  insert into boutiques (nom, code_invitation) values (trim(p_nom_boutique), c) returning id into b;
  insert into membres (boutique_id, user_id, role, nom)
    values (b, auth.uid(), 'proprietaire', trim(p_mon_nom));
  return b;
end $$;

grant execute on function creer_boutique(text, text) to authenticated;
grant execute on function rejoindre_boutique(text, text) to authenticated;

-- 1) Propriétaire peut renommer sa boutique
drop policy if exists b_modifier on boutiques;
create policy b_modifier on boutiques
  for update
  using (est_proprietaire(id))
  with check (est_proprietaire(id));

-- 2) Un membre peut modifier son propre nom ; la propriétaire peut aussi modifier les membres
drop policy if exists m_modifier on membres;
drop policy if exists m_modifier_soi on membres;
create policy m_modifier on membres
  for update
  using (est_proprietaire(boutique_id) or (user_id = auth.uid() and actif))
  with check (est_proprietaire(boutique_id) or user_id = auth.uid());
