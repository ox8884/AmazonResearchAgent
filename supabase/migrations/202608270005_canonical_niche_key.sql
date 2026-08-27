create or replace function public.canonical_niche_key(value text)
returns text
language sql
immutable
set search_path = public
as $$
  select trim(both from regexp_replace(lower(normalize(coalesce(value, ''), nfkc)), '[^[:alnum:]]+', ' ', 'g'));
$$;

create or replace function public.upsert_niche_cluster(
  canonical_key text,
  canonical_name text,
  canonical_english text,
  aliases jsonb,
  catalog_phrases jsonb,
  cluster_state text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cluster_id uuid;
  resolved_key text;
begin
  resolved_key := public.canonical_niche_key(coalesce(canonical_key, canonical_name));
  insert into public.niche_clusters (
    canonical_key,
    canonical_name,
    canonical_english,
    aliases,
    catalog_phrases,
    state
  ) values (
    resolved_key,
    $2,
    $3,
    coalesce($4, '[]'::jsonb),
    coalesce($5, '[]'::jsonb),
    $6
  )
  on conflict on constraint niche_clusters_canonical_key_key do update
  set canonical_name = excluded.canonical_name,
      canonical_english = coalesce(excluded.canonical_english, niche_clusters.canonical_english),
      aliases = public.jsonb_text_array_union(niche_clusters.aliases, excluded.aliases),
      catalog_phrases = public.jsonb_text_array_union(
        niche_clusters.catalog_phrases,
        excluded.catalog_phrases
      ),
      state = excluded.state,
      updated_at = now()
  returning id into cluster_id;

  return cluster_id;
end;
$$;
