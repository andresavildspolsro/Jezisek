-- Dárky mimo seznam i pro lidi, kteří v aplikaci nejsou: místo odkazu na
-- osobu se uloží jen jméno. Až se takový člověk do některé mojí skupiny
-- přidá, jde jeho zápisy propojit s jeho profilem.

alter table extra_gifts alter column recipient_id drop not null;
alter table extra_gifts add column recipient_name text
  check (recipient_name is null or length(trim(recipient_name)) between 1 and 40);
-- Právě jedno z obojího: buď člověk z aplikace, nebo jméno zvenčí.
alter table extra_gifts add constraint extra_gifts_recipient_ck
  check ((recipient_id is null) <> (recipient_name is null));
create index extra_gifts_recipient_name_idx on extra_gifts(buyer_id, lower(trim(recipient_name)));

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
    'extra', true
  );
$$;

-- Jméno pro porovnávání: bez mezer navíc a bez velikosti písmen.
create function _name_key(p_name text) returns text
language sql immutable set search_path = public, extensions, pg_temp as $$
  select lower(regexp_replace(coalesce(trim(p_name), ''), '\s+', ' ', 'g'));
$$;

drop function add_extra_gift(text, uuid, text, int, text, text);

-- Obdarovaný je buď p_recipient (člověk z aplikace), nebo p_recipient_name.
create function add_extra_gift(p_token text, p_recipient uuid, p_recipient_name text,
                               p_title text, p_tier int, p_url text, p_note text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token); e extra_gifts;
        t text := regexp_replace(coalesce(trim(p_title), ''), '\s+', ' ', 'g');
        n text := regexp_replace(coalesce(trim(p_recipient_name), ''), '\s+', ' ', 'g');
begin
  if p_recipient is not null then
    perform _assert_recipient(me, p_recipient);
    n := null;
  else
    if length(n) < 1 or length(n) > 40 then raise exception 'no_recipient'; end if;
    if _name_key(n) = _name_key(me.name) then raise exception 'own_gift'; end if;
  end if;
  if length(t) < 1 or length(t) > 120 then raise exception 'title_invalid'; end if;
  if p_tier is null or p_tier not between 1 and 3 then raise exception 'tier_invalid'; end if;
  insert into extra_gifts(buyer_id, recipient_id, recipient_name, title, tier, url, note)
  values (me.id, p_recipient, n, t, p_tier, _clean_url(p_url), nullif(trim(coalesce(p_note, '')), ''))
  returning * into e;
  return _extra_json(e);
end $$;

-- Propojení jména zvenčí s člověkem, který se mezitím přidal.
create function link_extra_recipient(p_token text, p_name text, p_person uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token); n int;
begin
  perform _assert_recipient(me, p_person);
  update extra_gifts set recipient_id = p_person, recipient_name = null
   where buyer_id = me.id and recipient_name is not null
     and _name_key(recipient_name) = _name_key(p_name);
  get diagnostics n = row_count;
  if n = 0 then raise exception 'not_found'; end if;
  return jsonb_build_object('linked', n);
end $$;

-- Oprava překlepu ve jméně zvenčí.
create function rename_extra_recipient(p_token text, p_name text, p_new_name text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token); n int;
        nn text := regexp_replace(coalesce(trim(p_new_name), ''), '\s+', ' ', 'g');
begin
  if length(nn) < 1 or length(nn) > 40 then raise exception 'no_recipient'; end if;
  update extra_gifts set recipient_name = nn
   where buyer_id = me.id and recipient_name is not null
     and _name_key(recipient_name) = _name_key(p_name);
  get diagnostics n = row_count;
  if n = 0 then raise exception 'not_found'; end if;
  return jsonb_build_object('renamed', n, 'name', nn);
end $$;

-- Nákupy: lidé z aplikace i jména zvenčí, u nich rovnou tipy na propojení.
create or replace function my_purchases(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp stable as $$
declare me people := _me(p_token);
begin
  return coalesce((
    select jsonb_agg(x order by x->>'off_app', lower(x->>'person_name'))
      from (
        select jsonb_build_object(
            'person_id', p.id,
            'person_name', p.name,
            'off_app', false,
            'suggestions', '[]'::jsonb,
            'gifts', coalesce((
              select jsonb_agg(_gift_json(g, me.id) order by g.tier, g.purchased_at)
                from gifts g where g.owner_id = p.id and g.purchased_by = me.id
            ), '[]'::jsonb),
            'extras', coalesce((
              select jsonb_agg(_extra_json(e) order by e.tier, e.created_at)
                from extra_gifts e where e.recipient_id = p.id and e.buyer_id = me.id
            ), '[]'::jsonb)
          ) as x
          from people p
         where exists (select 1 from gifts g where g.owner_id = p.id and g.purchased_by = me.id)
            or exists (select 1 from extra_gifts e where e.recipient_id = p.id and e.buyer_id = me.id)
        union all
        select jsonb_build_object(
            'person_id', null,
            'person_name', u.recipient_name,
            'off_app', true,
            'gifts', '[]'::jsonb,
            'extras', coalesce((
              select jsonb_agg(_extra_json(e) order by e.tier, e.created_at)
                from extra_gifts e
               where e.buyer_id = me.id and _name_key(e.recipient_name) = u.key
            ), '[]'::jsonb),
            -- Kdo z lidí, ke kterým teď mám přístup, by to mohl být.
            'suggestions', coalesce((
              select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by lower(c.name))
                from people c
               where c.id <> me.id
                 and (c.managed_by = me.id or _shares_group(me.id, c.id))
                 and (_name_key(c.name) = u.key
                      or split_part(_name_key(c.name), ' ', 1) = split_part(u.key, ' ', 1))
            ), '[]'::jsonb)
          ) as x
          from (
            select distinct on (_name_key(recipient_name))
                   _name_key(recipient_name) as key, recipient_name
              from extra_gifts
             where buyer_id = me.id and recipient_name is not null
             order by _name_key(recipient_name), created_at
          ) u
      ) t
  ), '[]'::jsonb);
end $$;

revoke execute on function
  _name_key(text),
  add_extra_gift(text, uuid, text, text, int, text, text),
  link_extra_recipient(text, text, uuid),
  rename_extra_recipient(text, text, text)
from public, anon, authenticated;

grant execute on function
  add_extra_gift(text, uuid, text, text, int, text, text),
  link_extra_recipient(text, text, uuid),
  rename_extra_recipient(text, text, text)
to anon;
