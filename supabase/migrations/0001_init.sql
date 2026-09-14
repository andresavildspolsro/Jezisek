-- Ježíšek: rodinné seznamy přání.
--
-- Veškerý přístup z aplikace jde přes funkce (RPC) volané anonymním klíčem.
-- Tabulky jsou pro klienta úplně zavřené (RLS bez politik + revoke), takže
-- pravidla překvapení („majitel seznamu nikdy nevidí stav svých dárků“) drží
-- na straně databáze, ne jen v prohlížeči.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tabulky
-- ---------------------------------------------------------------------------

create table groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 60),
  invite_code text not null unique,
  created_at  timestamptz not null default now()
);

create table people (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(trim(name)) between 1 and 40),
  pin_hash        text,                                -- null = dítě bez přihlášení
  managed_by      uuid references people(id) on delete cascade,
  is_admin        boolean not null default false,
  failed_attempts int not null default 0,
  locked_until    timestamptz,
  created_at      timestamptz not null default now(),
  check ((pin_hash is null) = (managed_by is not null))
);

create table group_members (
  group_id  uuid not null references groups(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, person_id)
);
create index group_members_person_idx on group_members(person_id);

create table gifts (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references people(id) on delete cascade,
  title        text not null check (length(trim(title)) between 1 and 120),
  tier         smallint not null check (tier between 1 and 3),
  url          text check (url is null or length(url) <= 2000),
  note         text check (note is null or length(note) <= 500),
  purchased_by uuid references people(id) on delete set null,
  purchased_at timestamptz,
  created_at   timestamptz not null default now(),
  check ((purchased_by is null) = (purchased_at is null))
);
create index gifts_owner_idx on gifts(owner_id);
create index gifts_purchased_by_idx on gifts(purchased_by);

create table sessions (
  token      text primary key,
  person_id  uuid not null references people(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_person_idx on sessions(person_id);

-- Klient se k tabulkám nedostane vůbec.
alter table groups        enable row level security;
alter table people        enable row level security;
alter table group_members enable row level security;
alter table gifts         enable row level security;
alter table sessions      enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Interní pomocné funkce (klient je volat nemůže)
-- ---------------------------------------------------------------------------

create function _me(p_token text) returns people
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v people;
begin
  select p.* into v
    from sessions s join people p on p.id = s.person_id
   where s.token = p_token and s.expires_at > now();
  if not found then
    raise exception 'unauthorized';
  end if;
  return v;
end $$;

create function _new_session(p_person uuid) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare t text := encode(gen_random_bytes(32), 'hex');
begin
  delete from sessions where expires_at < now();
  insert into sessions(token, person_id, expires_at)
  values (t, p_person, now() + interval '180 days');
  return t;
end $$;

create function _check_pin(p_pin text) returns void
language plpgsql immutable as $$
begin
  if p_pin is null or p_pin !~ '^[0-9]{4,6}$' then
    raise exception 'pin_invalid';
  end if;
end $$;

create function _clean_name(p_name text) returns text
language plpgsql immutable as $$
declare n text := regexp_replace(coalesce(trim(p_name), ''), '\s+', ' ', 'g');
begin
  if length(n) < 1 or length(n) > 40 then
    raise exception 'name_invalid';
  end if;
  return n;
end $$;

-- Jméno musí být ve skupině jedinečné (včetně dětí), bez ohledu na velikost písmen.
create function _assert_name_free(p_group uuid, p_name text, p_except uuid default null) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if exists (
    select 1 from group_members gm join people p on p.id = gm.person_id
     where gm.group_id = p_group
       and lower(p.name) = lower(p_name)
       and (p_except is null or p.id <> p_except)
  ) then
    raise exception 'name_taken';
  end if;
end $$;

create function _new_invite_code() returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from groups where invite_code = code);
  end loop;
  return code;
end $$;

create function _clean_url(p_url text) returns text
language plpgsql immutable as $$
declare u text := trim(coalesce(p_url, ''));
begin
  if u = '' then return null; end if;
  if u !~* '^https?://' then u := 'https://' || u; end if;
  if length(u) > 2000 then raise exception 'url_invalid'; end if;
  return u;
end $$;

create function _insert_gift(p_owner uuid, p_title text, p_tier int, p_url text, p_note text) returns gifts
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare g gifts; t text := regexp_replace(coalesce(trim(p_title), ''), '\s+', ' ', 'g');
begin
  if length(t) < 1 or length(t) > 120 then raise exception 'title_invalid'; end if;
  if p_tier is null or p_tier not between 1 and 3 then raise exception 'tier_invalid'; end if;
  insert into gifts(owner_id, title, tier, url, note)
  values (p_owner, t, p_tier, _clean_url(p_url), nullif(trim(coalesce(p_note, '')), ''))
  returning * into g;
  return g;
end $$;

create function _insert_gifts(p_owner uuid, p_gifts jsonb, p_min int) returns int
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare g jsonb; n int := 0;
begin
  if p_gifts is null or jsonb_typeof(p_gifts) <> 'array' then
    raise exception 'gifts_invalid';
  end if;
  for g in select * from jsonb_array_elements(p_gifts) loop
    perform _insert_gift(p_owner, g->>'title', (g->>'tier')::int, g->>'url', g->>'note');
    n := n + 1;
  end loop;
  if n < p_min then raise exception 'gifts_min'; end if;
  return n;
end $$;

-- Sdílí prohlížející s danou osobou nějakou skupinu?
create function _shares_group(p_a uuid, p_b uuid) returns boolean
language sql security definer set search_path = public, extensions, pg_temp stable as $$
  select exists (
    select 1 from group_members a join group_members b on a.group_id = b.group_id
     where a.person_id = p_a and b.person_id = p_b
  );
$$;

create function _gift_json(g gifts, p_viewer uuid) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'id', g.id,
    'title', g.title,
    'tier', g.tier,
    'url', g.url,
    'note', g.note,
    'created_at', g.created_at,
    -- Stav vidí jen někdo jiný než majitel seznamu.
    'taken', case when g.owner_id = p_viewer then null else (g.purchased_by is not null) end,
    'mine',  case when g.owner_id = p_viewer then null else (g.purchased_by = p_viewer) end
  );
$$;

-- ---------------------------------------------------------------------------
-- Veřejné API (bez přihlášení)
-- ---------------------------------------------------------------------------

-- Náhled skupiny podle kódu z pozvánky: název a jména lidí, kteří se mohou přihlásit.
create function group_preview(p_code text) returns jsonb
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
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by lower(p.name))
        from group_members gm join people p on p.id = gm.person_id
       where gm.group_id = g.id and p.managed_by is null
    ), '[]'::jsonb)
  );
end $$;

-- Založení nové skupiny prvním člověkem. Vrací token, kód pozvánky a id skupiny.
create function create_group(p_group_name text, p_name text, p_pin text, p_gifts jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare g groups; me people; gname text := regexp_replace(coalesce(trim(p_group_name), ''), '\s+', ' ', 'g');
begin
  if length(gname) < 1 or length(gname) > 60 then raise exception 'group_name_invalid'; end if;
  perform _check_pin(p_pin);
  insert into groups(name, invite_code) values (gname, _new_invite_code()) returning * into g;
  insert into people(name, pin_hash) values (_clean_name(p_name), crypt(p_pin, gen_salt('bf', 8)))
  returning * into me;
  insert into group_members(group_id, person_id) values (g.id, me.id);
  perform _insert_gifts(me.id, p_gifts, 3);
  return jsonb_build_object('token', _new_session(me.id), 'group_id', g.id, 'invite_code', g.invite_code);
end $$;

-- Registrace do existující skupiny podle kódu: jméno, PIN a aspoň tři dárky.
create function register(p_code text, p_name text, p_pin text, p_gifts jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare g groups; me people; n text;
begin
  select * into g from groups where invite_code = upper(trim(p_code));
  if not found then raise exception 'group_not_found'; end if;
  n := _clean_name(p_name);
  perform _check_pin(p_pin);
  perform _assert_name_free(g.id, n);
  insert into people(name, pin_hash) values (n, crypt(p_pin, gen_salt('bf', 8))) returning * into me;
  insert into group_members(group_id, person_id) values (g.id, me.id);
  perform _insert_gifts(me.id, p_gifts, 3);
  return jsonb_build_object('token', _new_session(me.id), 'group_id', g.id);
end $$;

-- Přihlášení jménem a PINem v rámci skupiny. Po 5 chybách zámek na 15 minut.
create function login(p_code text, p_name text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare g groups; me people;
begin
  select * into g from groups where invite_code = upper(trim(p_code));
  if not found then raise exception 'group_not_found'; end if;
  select p.* into me
    from group_members gm join people p on p.id = gm.person_id
   where gm.group_id = g.id and lower(p.name) = lower(trim(p_name)) and p.pin_hash is not null;
  if not found then raise exception 'bad_credentials'; end if;
  if me.locked_until is not null and me.locked_until > now() then
    raise exception 'locked';
  end if;
  if p_pin is null or me.pin_hash <> crypt(p_pin, me.pin_hash) then
    update people
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else null end
     where id = me.id;
    raise exception 'bad_credentials';
  end if;
  update people set failed_attempts = 0, locked_until = null where id = me.id;
  return jsonb_build_object('token', _new_session(me.id), 'group_id', g.id);
end $$;

-- ---------------------------------------------------------------------------
-- API pro přihlášené (první parametr je vždy token)
-- ---------------------------------------------------------------------------

create function logout(p_token text) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  delete from sessions where token = p_token;
end $$;

-- Kdo jsem, moje skupiny a moje děti.
create function me(p_token text) returns jsonb
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
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.created_at)
        from people c where c.managed_by = me.id
    ), '[]'::jsonb)
  );
end $$;

-- Přidání do další skupiny podle kódu (i s mými dětmi).
create function join_group(p_token text, p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token); g groups; c people;
begin
  select * into g from groups where invite_code = upper(trim(p_code));
  if not found then raise exception 'group_not_found'; end if;
  if exists (select 1 from group_members where group_id = g.id and person_id = me.id) then
    return jsonb_build_object('group_id', g.id, 'name', g.name, 'already', true);
  end if;
  perform _assert_name_free(g.id, me.name);
  for c in select * from people where managed_by = me.id loop
    perform _assert_name_free(g.id, c.name);
  end loop;
  insert into group_members(group_id, person_id) values (g.id, me.id);
  insert into group_members(group_id, person_id)
    select g.id, id from people where managed_by = me.id
    on conflict do nothing;
  return jsonb_build_object('group_id', g.id, 'name', g.name, 'already', false);
end $$;

-- Lidé ve skupině (kromě mě) s počtem dárků a počtem volných dárků.
create function group_people(p_token text, p_group uuid) returns jsonb
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
        'managed_by_me', p.managed_by = me.id,
        'gift_count', (select count(*) from gifts x where x.owner_id = p.id),
        'free_count', (select count(*) from gifts x where x.owner_id = p.id and x.purchased_by is null)
      ) order by (p.managed_by = me.id) desc, lower(p.name))
      from group_members gm join people p on p.id = gm.person_id
     where gm.group_id = p_group and p.id <> me.id
  ), '[]'::jsonb);
end $$;

-- Seznam dárků jedné osoby. Vlastní seznam přijde bez informace o stavu.
create function person_gifts(p_token text, p_person uuid) returns jsonb
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
    ), '[]'::jsonb)
  );
end $$;

create function _assert_manages(me people, p_owner uuid) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if p_owner <> me.id and not exists (select 1 from people where id = p_owner and managed_by = me.id) then
    raise exception 'forbidden';
  end if;
end $$;

create function add_gift(p_token text, p_owner uuid, p_title text, p_tier int, p_url text, p_note text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token); g gifts;
begin
  perform _assert_manages(me, p_owner);
  g := _insert_gift(p_owner, p_title, p_tier, p_url, p_note);
  return _gift_json(g, me.id);
end $$;

-- Úprava je dovolena vždy (i u koupeného dárku), aby se z odmítnutí nedal vyčíst stav.
create function update_gift(p_token text, p_gift uuid, p_title text, p_tier int, p_url text, p_note text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token); g gifts; t text := regexp_replace(coalesce(trim(p_title), ''), '\s+', ' ', 'g');
begin
  select * into g from gifts where id = p_gift;
  if not found then raise exception 'not_found'; end if;
  perform _assert_manages(me, g.owner_id);
  if length(t) < 1 or length(t) > 120 then raise exception 'title_invalid'; end if;
  if p_tier is null or p_tier not between 1 and 3 then raise exception 'tier_invalid'; end if;
  update gifts set title = t, tier = p_tier, url = _clean_url(p_url), note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_gift returning * into g;
  return _gift_json(g, me.id);
end $$;

-- Smazat jde jen dárek, který ještě nikdo nekoupil.
create function delete_gift(p_token text, p_gift uuid) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token); g gifts;
begin
  select * into g from gifts where id = p_gift;
  if not found then raise exception 'not_found'; end if;
  perform _assert_manages(me, g.owner_id);
  if g.purchased_by is not null then raise exception 'gift_purchased'; end if;
  delete from gifts where id = p_gift;
end $$;

-- „Koupím to já“: jeden kupující na dárek, vlastní dárek koupit nejde.
create function claim_gift(p_token text, p_gift uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token); g gifts;
begin
  select * into g from gifts where id = p_gift for update;
  if not found then raise exception 'not_found'; end if;
  if g.owner_id = me.id then raise exception 'own_gift'; end if;
  if not exists (select 1 from people where id = g.owner_id and managed_by = me.id)
     and not _shares_group(me.id, g.owner_id) then
    raise exception 'forbidden';
  end if;
  if g.purchased_by is not null and g.purchased_by <> me.id then raise exception 'already_taken'; end if;
  update gifts set purchased_by = me.id, purchased_at = coalesce(purchased_at, now())
   where id = p_gift returning * into g;
  return _gift_json(g, me.id);
end $$;

create function unclaim_gift(p_token text, p_gift uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token); g gifts;
begin
  select * into g from gifts where id = p_gift for update;
  if not found then raise exception 'not_found'; end if;
  if g.purchased_by is distinct from me.id then raise exception 'not_yours'; end if;
  update gifts set purchased_by = null, purchased_at = null where id = p_gift returning * into g;
  return _gift_json(g, me.id);
end $$;

-- Co jsem slíbil koupit, seskupené podle obdarovaného.
create function my_purchases(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp stable as $$
declare me people := _me(p_token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'person_id', p.id,
        'person_name', p.name,
        'gifts', (
          select jsonb_agg(_gift_json(g, me.id) order by g.tier, g.purchased_at)
            from gifts g where g.owner_id = p.id and g.purchased_by = me.id
        )
      ) order by lower(p.name))
      from people p
     where exists (select 1 from gifts g where g.owner_id = p.id and g.purchased_by = me.id)
  ), '[]'::jsonb);
end $$;

-- Dítě: profil bez PINu, spravuje ho rodič. Je ve všech skupinách rodiče.
create function add_child(p_token text, p_name text, p_gifts jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token); c people; n text := _clean_name(p_name); gid uuid;
begin
  for gid in select group_id from group_members where person_id = me.id loop
    perform _assert_name_free(gid, n);
  end loop;
  insert into people(name, managed_by) values (n, me.id) returning * into c;
  insert into group_members(group_id, person_id)
    select group_id, c.id from group_members where person_id = me.id;
  perform _insert_gifts(c.id, p_gifts, 3);
  return jsonb_build_object('id', c.id, 'name', c.name);
end $$;

create function remove_child(p_token text, p_child uuid) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token);
begin
  if not exists (select 1 from people where id = p_child and managed_by = me.id) then
    raise exception 'forbidden';
  end if;
  if exists (select 1 from gifts where owner_id = p_child and purchased_by is not null) then
    raise exception 'gift_purchased';
  end if;
  delete from people where id = p_child;
end $$;

create function change_pin(p_token text, p_old text, p_new text) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token);
begin
  perform _check_pin(p_new);
  if p_old is null or me.pin_hash <> crypt(p_old, me.pin_hash) then raise exception 'bad_credentials'; end if;
  update people set pin_hash = crypt(p_new, gen_salt('bf', 8)) where id = me.id;
end $$;

-- ---------------------------------------------------------------------------
-- Správce (is_admin nastavuje jen vlastník databáze ručně)
-- ---------------------------------------------------------------------------

create function admin_overview(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp stable as $$
declare me people := _me(p_token);
begin
  if not me.is_admin then raise exception 'forbidden'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', g.id, 'name', g.name, 'invite_code', g.invite_code, 'created_at', g.created_at,
        'members', coalesce((
          select jsonb_agg(jsonb_build_object(
              'id', p.id, 'name', p.name, 'is_child', p.managed_by is not null,
              'locked', p.locked_until is not null and p.locked_until > now(),
              'gift_count', (select count(*) from gifts x where x.owner_id = p.id),
              'bought_count', (select count(*) from gifts x where x.owner_id = p.id and x.purchased_by is not null)
            ) order by lower(p.name))
            from group_members gm join people p on p.id = gm.person_id where gm.group_id = g.id
        ), '[]'::jsonb)
      ) order by g.created_at)
      from groups g
  ), '[]'::jsonb);
end $$;

create function admin_reset_pin(p_token text, p_person uuid, p_new text) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token);
begin
  if not me.is_admin then raise exception 'forbidden'; end if;
  perform _check_pin(p_new);
  update people set pin_hash = crypt(p_new, gen_salt('bf', 8)), failed_attempts = 0, locked_until = null
   where id = p_person and pin_hash is not null;
  if not found then raise exception 'not_found'; end if;
  delete from sessions where person_id = p_person;
end $$;

create function admin_remove_person(p_token text, p_person uuid) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token);
begin
  if not me.is_admin then raise exception 'forbidden'; end if;
  if p_person = me.id then raise exception 'forbidden'; end if;
  delete from people where id = p_person;
end $$;

create function admin_delete_group(p_token text, p_group uuid) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token);
begin
  if not me.is_admin then raise exception 'forbidden'; end if;
  delete from groups where id = p_group;
  -- Lidé, kteří tím přišli o poslední skupinu, zůstávají; správce je může smazat zvlášť.
end $$;

-- ---------------------------------------------------------------------------
-- Oprávnění: klient smí volat jen veřejné API funkce.
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  group_preview(text),
  create_group(text, text, text, jsonb),
  register(text, text, text, jsonb),
  login(text, text, text),
  logout(text),
  me(text),
  join_group(text, text),
  group_people(text, uuid),
  person_gifts(text, uuid),
  add_gift(text, uuid, text, int, text, text),
  update_gift(text, uuid, text, int, text, text),
  delete_gift(text, uuid),
  claim_gift(text, uuid),
  unclaim_gift(text, uuid),
  my_purchases(text),
  add_child(text, text, jsonb),
  remove_child(text, uuid),
  change_pin(text, text, text),
  admin_overview(text),
  admin_reset_pin(text, uuid, text),
  admin_remove_person(text, uuid),
  admin_delete_group(text, uuid)
to anon;
