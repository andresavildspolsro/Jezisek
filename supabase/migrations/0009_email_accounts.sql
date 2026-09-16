-- Přihlášení e-mailem a Googlem vedle dosavadního jména s PINem.
--
-- Vlastní relace (tabulka sessions) zůstávají tím, čím se aplikace prokazuje.
-- Supabase Auth slouží jen k ověření, kdo jsi: klient si u něj vyzvedne JWT,
-- pošle ho do funkce níž a dostane výměnou obvyklý token aplikace.

alter table people add column auth_user_id uuid unique references auth.users(id) on delete set null;
alter table people add column email text;

-- Dítě nemá ani PIN, ani účet; dospělý musí mít aspoň jedno z toho.
alter table people drop constraint people_check;
alter table people add constraint people_kind_ck check (
  (managed_by is not null and pin_hash is null and auth_user_id is null)
  or (managed_by is null and (pin_hash is not null or auth_user_id is not null))
);

-- Kdo je přihlášený přes Supabase Auth. Null, když request nese jen anon klíč.
create function _auth_uid() returns uuid
language sql stable set search_path = public, extensions, pg_temp as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create function _auth_email() returns text
language sql stable set search_path = public, extensions, pg_temp as $$
  select nullif(current_setting('request.jwt.claim.email', true), '');
$$;

-- Přihlášení účtem: vrátí token aplikace, nebo řekne, že profil ještě není.
create function session_from_auth() returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := _auth_uid(); mail text := _auth_email(); p people;
begin
  if uid is null then raise exception 'unauthorized'; end if;
  select * into p from people where auth_user_id = uid;
  if not found then
    return jsonb_build_object('needs_profile', true, 'email', mail);
  end if;
  if mail is not null and p.email is distinct from mail then
    update people set email = mail where id = p.id;
  end if;
  return jsonb_build_object('needs_profile', false, 'token', _new_session(p.id),
                            'group_id', (select group_id from group_members
                                          where person_id = p.id order by joined_at limit 1));
end $$;

-- Registrace do skupiny účtem místo PINu.
create function register_with_auth(p_code text, p_name text, p_gifts jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := _auth_uid(); mail text := _auth_email(); g groups; me people; n text;
begin
  if uid is null then raise exception 'unauthorized'; end if;
  if exists (select 1 from people where auth_user_id = uid) then raise exception 'account_taken'; end if;
  select * into g from groups where invite_code = upper(trim(p_code));
  if not found then raise exception 'group_not_found'; end if;
  n := _clean_name(p_name);
  perform _assert_name_free(g.id, n);
  insert into people(name, auth_user_id, email) values (n, uid, mail) returning * into me;
  insert into group_members(group_id, person_id) values (g.id, me.id);
  perform _insert_gifts(me.id, p_gifts, 3);
  return jsonb_build_object('token', _new_session(me.id), 'group_id', g.id);
end $$;

-- Založení skupiny účtem místo PINu.
create function create_group_with_auth(p_group_name text, p_name text, p_gifts jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := _auth_uid(); mail text := _auth_email(); g groups; me people;
        gname text := regexp_replace(coalesce(trim(p_group_name), ''), '\s+', ' ', 'g');
begin
  if uid is null then raise exception 'unauthorized'; end if;
  if exists (select 1 from people where auth_user_id = uid) then raise exception 'account_taken'; end if;
  if length(gname) < 1 or length(gname) > 60 then raise exception 'group_name_invalid'; end if;
  insert into groups(name, invite_code) values (gname, _new_invite_code()) returning * into g;
  insert into people(name, auth_user_id, email) values (_clean_name(p_name), uid, mail) returning * into me;
  insert into group_members(group_id, person_id) values (g.id, me.id);
  perform _insert_gifts(me.id, p_gifts, 3);
  return jsonb_build_object('token', _new_session(me.id), 'group_id', g.id, 'invite_code', g.invite_code);
end $$;

-- Připojení účtu ke stávajícímu profilu, který dosud měl jen PIN.
create function link_auth(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token); uid uuid := _auth_uid(); mail text := _auth_email();
begin
  if uid is null then raise exception 'unauthorized'; end if;
  if exists (select 1 from people where auth_user_id = uid and id <> me.id) then raise exception 'account_taken'; end if;
  update people set auth_user_id = uid, email = coalesce(mail, email) where id = me.id;
  return jsonb_build_object('email', coalesce(mail, me.email));
end $$;

-- Odpojení účtu. Bez PINu by se člověk neměl jak přihlásit, proto to hlídáme.
create function unlink_auth(p_token text) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token);
begin
  if me.pin_hash is null then raise exception 'need_pin_first'; end if;
  update people set auth_user_id = null, email = null where id = me.id;
end $$;

-- Nastavení nebo změna PINu u účtu, který ho zatím nemá.
create or replace function change_pin(p_token text, p_old text, p_new text) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token);
begin
  perform _check_pin(p_new);
  if me.pin_hash is not null then
    if p_old is null or me.pin_hash <> crypt(p_old, me.pin_hash) then raise exception 'bad_credentials'; end if;
  end if;
  update people set pin_hash = crypt(p_new, gen_salt('bf', 8)) where id = me.id;
end $$;

-- Profil nese i e-mail a informaci, jak se dá přihlásit.
create or replace function me(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp stable as $$
declare me people := _me(p_token);
begin
  return jsonb_build_object(
    'id', me.id,
    'name', me.name,
    'is_admin', me.is_admin,
    'email', me.email,
    'has_pin', me.pin_hash is not null,
    'has_account', me.auth_user_id is not null,
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

-- Náhled skupiny říká, kdo se přihlašuje PINem a kdo účtem.
create or replace function group_preview(p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp stable as $$
declare g groups;
begin
  select * into g from groups where invite_code = upper(trim(p_code));
  if not found then return null; end if;
  return jsonb_build_object(
    'id', g.id,
    'name', g.name,
    'invite_code', g.invite_code,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'has_pin', p.pin_hash is not null)
                       order by lower(p.name))
        from group_members gm join people p on p.id = gm.person_id
       where gm.group_id = g.id and p.managed_by is null
    ), '[]'::jsonb)
  );
end $$;

-- Druhým rodičem může být kdokoli, kdo není dítě (dřív se poznávalo podle PINu).
create or replace function add_guardian(p_token text, p_child uuid, p_person uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token); c people; g people; gid uuid;
begin
  if not _is_guardian(me.id, p_child) then raise exception 'forbidden'; end if;
  select * into c from people where id = p_child;
  select * into g from people where id = p_person;
  if not found or g.managed_by is not null then raise exception 'not_found'; end if;
  if g.id = me.id or not _shares_group(me.id, g.id) then raise exception 'forbidden'; end if;
  if _is_guardian(g.id, p_child) then
    return jsonb_build_object('guardians', _guardians_json(p_child), 'already', true);
  end if;
  for gid in select group_id from group_members where person_id = g.id loop
    perform _assert_name_free(gid, c.name, c.id);
  end loop;
  insert into child_guardians(child_id, guardian_id) values (p_child, g.id);
  insert into group_members(group_id, person_id)
    select group_id, c.id from group_members where person_id = g.id
    on conflict do nothing;
  return jsonb_build_object('guardians', _guardians_json(p_child), 'already', false);
end $$;

revoke execute on function _auth_uid(), _auth_email() from public, anon, authenticated;

revoke execute on function
  session_from_auth(),
  register_with_auth(text, text, jsonb),
  create_group_with_auth(text, text, jsonb),
  link_auth(text),
  unlink_auth(text)
from public, anon, authenticated;

-- Funkce nad účtem volá přihlášený klient (JWT), zbytek anonymní klíč s tokenem.
grant execute on function
  session_from_auth(),
  register_with_auth(text, text, jsonb),
  create_group_with_auth(text, text, jsonb),
  link_auth(text)
to authenticated;

grant execute on function unlink_auth(text) to anon;
