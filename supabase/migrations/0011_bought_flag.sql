-- Soukromá značka „už koupeno“ u dárku, který jsem si zamluvil. Slouží jen
-- mně jako přehled nákupů; nikdo jiný ji nevidí, obdarovaný už vůbec ne.

alter table gifts add column bought_at timestamptz;
alter table extra_gifts add column bought_at timestamptz;

-- Stav koupení vidí jen ten, kdo si dárek zamluvil.
create or replace function _gift_json(g gifts, p_viewer uuid) returns jsonb
language sql immutable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object(
    'id', g.id,
    'title', g.title,
    'tier', g.tier,
    'url', g.url,
    'note', g.note,
    'created_at', g.created_at,
    'taken', case when g.owner_id = p_viewer then null else (g.purchased_by is not null) end,
    'mine',  case when g.owner_id = p_viewer then null else (g.purchased_by = p_viewer) end,
    'bought', case when g.purchased_by = p_viewer then (g.bought_at is not null) else null end
  );
$$;

create or replace function _extra_json(e extra_gifts) returns jsonb
language sql immutable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object(
    'id', e.id,
    'recipient_id', e.recipient_id,
    'recipient_name', e.recipient_name,
    'title', e.title,
    'tier', e.tier,
    'url', e.url,
    'note', e.note,
    'created_at', e.created_at,
    'extra', true,
    'bought', e.bought_at is not null
  );
$$;

create function set_gift_bought(p_token text, p_gift uuid, p_bought boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token); g gifts;
begin
  update gifts set bought_at = case when p_bought then coalesce(bought_at, now()) else null end
   where id = p_gift and purchased_by = me.id
  returning * into g;
  if not found then raise exception 'not_yours'; end if;
  return _gift_json(g, me.id);
end $$;

create function set_extra_bought(p_token text, p_extra uuid, p_bought boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token); e extra_gifts;
begin
  update extra_gifts set bought_at = case when p_bought then coalesce(bought_at, now()) else null end
   where id = p_extra and buyer_id = me.id
  returning * into e;
  if not found then raise exception 'not_found'; end if;
  return _extra_json(e);
end $$;

-- Vrácení dárku smaže i značku, aby ji nezdědil další kupující.
create or replace function unclaim_gift(p_token text, p_gift uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token); g gifts;
begin
  select * into g from gifts where id = p_gift for update;
  if not found then raise exception 'not_found'; end if;
  if g.purchased_by is distinct from me.id then raise exception 'not_yours'; end if;
  update gifts set purchased_by = null, purchased_at = null, bought_at = null
   where id = p_gift returning * into g;
  return _gift_json(g, me.id);
end $$;

-- Zamluvení jiným člověkem začíná vždy s čistým štítem.
create or replace function claim_gift(p_token text, p_gift uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token); g gifts;
begin
  select * into g from gifts where id = p_gift for update;
  if not found then raise exception 'not_found'; end if;
  if g.owner_id = me.id then raise exception 'own_gift'; end if;
  if not _is_guardian(me.id, g.owner_id) and not _shares_group(me.id, g.owner_id) then
    raise exception 'forbidden';
  end if;
  if g.purchased_by is not null and g.purchased_by <> me.id then raise exception 'already_taken'; end if;
  update gifts set purchased_by = me.id,
                   purchased_at = coalesce(purchased_at, now()),
                   bought_at = case when purchased_by = me.id then bought_at else null end
   where id = p_gift returning * into g;
  return _gift_json(g, me.id);
end $$;

revoke execute on function set_gift_bought(text, uuid, boolean), set_extra_bought(text, uuid, boolean)
from public, anon, authenticated;

grant execute on function set_gift_bought(text, uuid, boolean), set_extra_bought(text, uuid, boolean) to anon;
