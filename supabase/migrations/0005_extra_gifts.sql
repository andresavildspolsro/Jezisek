-- Dárky mimo seznam: co jsem někomu koupil, i když si to nepřál.
-- Vidí je jen kupující, obdarovaný ani nikdo jiný se k nim nedostane.

create table extra_gifts (
  id           uuid primary key default gen_random_uuid(),
  buyer_id     uuid not null references people(id) on delete cascade,
  recipient_id uuid not null references people(id) on delete cascade,
  title        text not null check (length(trim(title)) between 1 and 120),
  tier         smallint not null check (tier between 1 and 3),
  url          text check (url is null or length(url) <= 2000),
  note         text check (note is null or length(note) <= 500),
  created_at   timestamptz not null default now(),
  check (buyer_id <> recipient_id)
);
create index extra_gifts_buyer_idx on extra_gifts(buyer_id);
create index extra_gifts_recipient_idx on extra_gifts(recipient_id);

alter table extra_gifts enable row level security;
revoke all on table extra_gifts from anon, authenticated;

create function _extra_json(e extra_gifts) returns jsonb
language sql immutable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object(
    'id', e.id,
    'recipient_id', e.recipient_id,
    'title', e.title,
    'tier', e.tier,
    'url', e.url,
    'note', e.note,
    'created_at', e.created_at,
    'extra', true
  );
$$;

-- Komu smím koupit dárek mimo seznam: kdokoli z mých skupin a moje děti.
create function _assert_recipient(me people, p_recipient uuid) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if p_recipient = me.id then raise exception 'own_gift'; end if;
  if not exists (select 1 from people where id = p_recipient and managed_by = me.id)
     and not _shares_group(me.id, p_recipient) then
    raise exception 'forbidden';
  end if;
end $$;

create function add_extra_gift(p_token text, p_recipient uuid, p_title text, p_tier int, p_url text, p_note text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token); e extra_gifts;
        t text := regexp_replace(coalesce(trim(p_title), ''), '\s+', ' ', 'g');
begin
  perform _assert_recipient(me, p_recipient);
  if length(t) < 1 or length(t) > 120 then raise exception 'title_invalid'; end if;
  if p_tier is null or p_tier not between 1 and 3 then raise exception 'tier_invalid'; end if;
  insert into extra_gifts(buyer_id, recipient_id, title, tier, url, note)
  values (me.id, p_recipient, t, p_tier, _clean_url(p_url), nullif(trim(coalesce(p_note, '')), ''))
  returning * into e;
  return _extra_json(e);
end $$;

create function update_extra_gift(p_token text, p_extra uuid, p_title text, p_tier int, p_url text, p_note text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token); e extra_gifts;
        t text := regexp_replace(coalesce(trim(p_title), ''), '\s+', ' ', 'g');
begin
  select * into e from extra_gifts where id = p_extra and buyer_id = me.id;
  if not found then raise exception 'not_found'; end if;
  if length(t) < 1 or length(t) > 120 then raise exception 'title_invalid'; end if;
  if p_tier is null or p_tier not between 1 and 3 then raise exception 'tier_invalid'; end if;
  update extra_gifts set title = t, tier = p_tier, url = _clean_url(p_url),
                         note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_extra returning * into e;
  return _extra_json(e);
end $$;

create function delete_extra_gift(p_token text, p_extra uuid) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token);
begin
  delete from extra_gifts where id = p_extra and buyer_id = me.id;
  if not found then raise exception 'not_found'; end if;
end $$;

-- Komu můžu něco koupit: všichni z mých skupin a moje děti.
create function my_recipients(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp stable as $$
declare me people := _me(p_token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'is_child', p.managed_by is not null)
                     order by lower(p.name))
      from people p
     where p.id <> me.id
       and (p.managed_by = me.id or _shares_group(me.id, p.id))
  ), '[]'::jsonb);
end $$;

-- Nákupy teď obsahují i dárky mimo seznam.
create or replace function my_purchases(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp stable as $$
declare me people := _me(p_token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'person_id', p.id,
        'person_name', p.name,
        'gifts', coalesce((
          select jsonb_agg(_gift_json(g, me.id) order by g.tier, g.purchased_at)
            from gifts g where g.owner_id = p.id and g.purchased_by = me.id
        ), '[]'::jsonb),
        'extras', coalesce((
          select jsonb_agg(_extra_json(e) order by e.tier, e.created_at)
            from extra_gifts e where e.recipient_id = p.id and e.buyer_id = me.id
        ), '[]'::jsonb)
      ) order by lower(p.name))
      from people p
     where exists (select 1 from gifts g where g.owner_id = p.id and g.purchased_by = me.id)
        or exists (select 1 from extra_gifts e where e.recipient_id = p.id and e.buyer_id = me.id)
  ), '[]'::jsonb);
end $$;

-- Seznam člověka nese i to, co pro něj mám mimo jeho přání (vidím jen já).
create or replace function person_gifts(p_token text, p_person uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp stable as $$
declare me people := _me(p_token); owner people;
begin
  select * into owner from people where id = p_person;
  if not found then raise exception 'not_found'; end if;
  if owner.id <> me.id and owner.managed_by is distinct from me.id and not _shares_group(me.id, owner.id) then
    raise exception 'forbidden';
  end if;
  return jsonb_build_object(
    'person', jsonb_build_object('id', owner.id, 'name', owner.name,
                                 'is_child', owner.managed_by is not null,
                                 'managed_by_me', owner.managed_by = me.id,
                                 'is_me', owner.id = me.id),
    'gifts', coalesce((
      select jsonb_agg(_gift_json(g, me.id) order by g.tier, g.created_at)
        from gifts g where g.owner_id = owner.id
    ), '[]'::jsonb),
    'extras', coalesce((
      select jsonb_agg(_extra_json(e) order by e.tier, e.created_at)
        from extra_gifts e where e.recipient_id = owner.id and e.buyer_id = me.id
    ), '[]'::jsonb)
  );
end $$;

revoke execute on function
  add_extra_gift(text, uuid, text, int, text, text),
  update_extra_gift(text, uuid, text, int, text, text),
  delete_extra_gift(text, uuid),
  my_recipients(text)
from public, anon, authenticated;

grant execute on function
  add_extra_gift(text, uuid, text, int, text, text),
  update_extra_gift(text, uuid, text, int, text, text),
  delete_extra_gift(text, uuid),
  my_recipients(text)
to anon;
