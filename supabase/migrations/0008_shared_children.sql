-- Dítě může mít víc rodičů. Kdo dítě spravuje, je nově v tabulce
-- child_guardians; `people.managed_by` zůstává jako zakladatel (drží se na
-- něm kontrola „dítě nemá PIN“) a při jeho odchodu se přepíše na jiného.

create table child_guardians (
  child_id    uuid not null references people(id) on delete cascade,
  guardian_id uuid not null references people(id) on delete cascade,
  added_at    timestamptz not null default now(),
  primary key (child_id, guardian_id)
);
create index child_guardians_guardian_idx on child_guardians(guardian_id);

alter table child_guardians enable row level security;
revoke all on table child_guardians from anon, authenticated;

-- Dosavadní děti: zakladatel je zároveň první rodič.
insert into child_guardians(child_id, guardian_id)
  select id, managed_by from people where managed_by is not null
  on conflict do nothing;

create function _is_guardian(p_person uuid, p_child uuid) returns boolean
language sql security definer set search_path = public, extensions, pg_temp stable as $$
  select exists (select 1 from child_guardians where child_id = p_child and guardian_id = p_person);
$$;

create function _guardians_json(p_child uuid) returns jsonb
language sql security definer set search_path = public, extensions, pg_temp stable as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by cg.added_at)
      from child_guardians cg join people p on p.id = cg.guardian_id
     where cg.child_id = p_child
  ), '[]'::jsonb);
$$;

-- --- přepsané funkce, které dosud četly managed_by ------------------------

create or replace function _assert_manages(me people, p_owner uuid) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if p_owner <> me.id and not _is_guardian(me.id, p_owner) then
    raise exception 'forbidden';
  end if;
end $$;

create or replace function _assert_recipient(me people, p_recipient uuid) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if p_recipient = me.id then raise exception 'own_gift'; end if;
  if not _is_guardian(me.id, p_recipient) and not _shares_group(me.id, p_recipient) then
    raise exception 'forbidden';
  end if;
end $$;

create or replace function me(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp stable as $$
declare me people := _me(p_token);
begin
  return jsonb_build_object(
    'id', me.id,
    'name', me.name,
    'is_admin', me.is_admin,
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'invite_code', g.invite_code) order by gm.joined_at)
        from group_members gm join groups g on g.id = gm.group_id
       where gm.person_id = me.id
    ), '[]'::jsonb),
    'children', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'guardians', _guardians_json(c.id))
                       order by c.created_at)
        from child_guardians cg join people c on c.id = cg.child_id
       where cg.guardian_id = me.id
    ), '[]'::jsonb)
  );
end $$;

create or replace function join_group(p_token text, p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token); g groups; c people;
begin
  select * into g from groups where invite_code = upper(trim(p_code));
  if not found then raise exception 'group_not_found'; end if;
  if exists (select 1 from group_members where group_id = g.id and person_id = me.id) then
    return jsonb_build_object('group_id', g.id, 'name', g.name, 'already', true);
  end if;
  perform _assert_name_free(g.id, me.name);
  for c in select p.* from child_guardians cg join people p on p.id = cg.child_id where cg.guardian_id = me.id loop
    perform _assert_name_free(g.id, c.name, c.id);
  end loop;
  insert into group_members(group_id, person_id) values (g.id, me.id);
  insert into group_members(group_id, person_id)
    select g.id, cg.child_id from child_guardians cg where cg.guardian_id = me.id
    on conflict do nothing;
  return jsonb_build_object('group_id', g.id, 'name', g.name, 'already', false);
end $$;

create or replace function group_people(p_token text, p_group uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp stable as $$
declare me people := _me(p_token);
begin
  if not exists (select 1 from group_members where group_id = p_group and person_id = me.id) then
    raise exception 'forbidden';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'is_child', p.managed_by is not null,
        'managed_by_me', _is_guardian(me.id, p.id),
        'gift_count', (select count(*) from gifts x where x.owner_id = p.id),
        'free_count', (select count(*) from gifts x where x.owner_id = p.id and x.purchased_by is null)
      ) order by _is_guardian(me.id, p.id) desc, lower(p.name))
      from group_members gm join people p on p.id = gm.person_id
     where gm.group_id = p_group and p.id <> me.id
  ), '[]'::jsonb);
end $$;

create or replace function person_gifts(p_token text, p_person uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp stable as $$
declare me people := _me(p_token); owner people;
begin
  select * into owner from people where id = p_person;
  if not found then raise exception 'not_found'; end if;
  if owner.id <> me.id and not _is_guardian(me.id, owner.id) and not _shares_group(me.id, owner.id) then
    raise exception 'forbidden';
  end if;
  return jsonb_build_object(
    'person', jsonb_build_object('id', owner.id, 'name', owner.name,
                                 'is_child', owner.managed_by is not null,
                                 'managed_by_me', _is_guardian(me.id, owner.id),
                                 'is_me', owner.id = me.id,
                                 'guardians', case when owner.managed_by is not null
                                                   then _guardians_json(owner.id) else '[]'::jsonb end),
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
  update gifts set purchased_by = me.id, purchased_at = coalesce(purchased_at, now())
   where id = p_gift returning * into g;
  return _gift_json(g, me.id);
end $$;

create or replace function my_recipients(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp stable as $$
declare me people := _me(p_token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'is_child', p.managed_by is not null)
                     order by lower(p.name))
      from people p
     where p.id <> me.id
       and (_is_guardian(me.id, p.id) or _shares_group(me.id, p.id))
  ), '[]'::jsonb);
end $$;

create or replace function add_child(p_token text, p_name text, p_gifts jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token); c people; n text := _clean_name(p_name); gid uuid;
begin
  for gid in select group_id from group_members where person_id = me.id loop
    perform _assert_name_free(gid, n);
  end loop;
  insert into people(name, managed_by) values (n, me.id) returning * into c;
  insert into child_guardians(child_id, guardian_id) values (c.id, me.id);
  insert into group_members(group_id, person_id)
    select group_id, c.id from group_members where person_id = me.id;
  perform _insert_gifts(c.id, p_gifts, 3);
  return jsonb_build_object('id', c.id, 'name', c.name, 'guardians', _guardians_json(c.id));
end $$;

-- Odebrání dítěte: pokud ho spravuje i někdo další, zmizí jen z mého
-- seznamu; jsem-li poslední, smaže se celý profil i s přáními.
drop function remove_child(text, uuid);
create function remove_child(p_token text, p_child uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token); others int;
begin
  if not _is_guardian(me.id, p_child) then raise exception 'forbidden'; end if;
  select count(*) - 1 into others from child_guardians where child_id = p_child;
  if others > 0 then
    delete from child_guardians where child_id = p_child and guardian_id = me.id;
    update people set managed_by = (select guardian_id from child_guardians
                                     where child_id = p_child order by added_at limit 1)
     where id = p_child and managed_by = me.id;
    return jsonb_build_object('deleted', false);
  end if;
  if exists (select 1 from gifts where owner_id = p_child and purchased_by is not null) then
    raise exception 'gift_purchased';
  end if;
  delete from people where id = p_child;
  return jsonb_build_object('deleted', true);
end $$;

-- --- sdílení dítěte s druhým rodičem --------------------------------------

create function add_guardian(p_token text, p_child uuid, p_person uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token); c people; g people; gid uuid;
begin
  if not _is_guardian(me.id, p_child) then raise exception 'forbidden'; end if;
  select * into c from people where id = p_child;
  select * into g from people where id = p_person;
  if not found or g.pin_hash is null then raise exception 'not_found'; end if;
  if g.id = me.id or not _shares_group(me.id, g.id) then raise exception 'forbidden'; end if;
  if _is_guardian(g.id, p_child) then
    return jsonb_build_object('guardians', _guardians_json(p_child), 'already', true);
  end if;
  -- Jméno dítěte musí být volné i ve skupinách druhého rodiče.
  for gid in select group_id from group_members where person_id = g.id loop
    perform _assert_name_free(gid, c.name, c.id);
  end loop;
  insert into child_guardians(child_id, guardian_id) values (p_child, g.id);
  insert into group_members(group_id, person_id)
    select group_id, c.id from group_members where person_id = g.id
    on conflict do nothing;
  return jsonb_build_object('guardians', _guardians_json(p_child), 'already', false);
end $$;

-- Sebe může odebrat každý rodič, ostatní jen zakladatel. Poslední ne.
create function remove_guardian(p_token text, p_child uuid, p_person uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token); c people; n int;
begin
  if not _is_guardian(me.id, p_child) then raise exception 'forbidden'; end if;
  select * into c from people where id = p_child;
  if p_person <> me.id and c.managed_by <> me.id then raise exception 'forbidden'; end if;
  select count(*) into n from child_guardians where child_id = p_child;
  if n <= 1 then raise exception 'last_guardian'; end if;
  delete from child_guardians where child_id = p_child and guardian_id = p_person;
  if not found then raise exception 'not_found'; end if;
  update people set managed_by = (select guardian_id from child_guardians
                                   where child_id = p_child order by added_at limit 1)
   where id = p_child and managed_by = p_person;
  return jsonb_build_object('guardians', _guardians_json(p_child));
end $$;

revoke execute on function
  _is_guardian(uuid, uuid),
  _guardians_json(uuid),
  remove_child(text, uuid),
  add_guardian(text, uuid, uuid),
  remove_guardian(text, uuid, uuid)
from public, anon, authenticated;

grant execute on function
  remove_child(text, uuid),
  add_guardian(text, uuid, uuid),
  remove_guardian(text, uuid, uuid)
to anon;
