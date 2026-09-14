-- Přihlášení vrací chyby jako hodnotu ('error'), ne výjimkou: výjimka by
-- odrolovala i zápis počítadla neúspěšných pokusů a zámek by nikdy nenastal.
create or replace function login(p_code text, p_name text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare g groups; me people; attempts int;
begin
  select * into g from groups where invite_code = upper(trim(p_code));
  if not found then raise exception 'group_not_found'; end if;
  select p.* into me
    from group_members gm join people p on p.id = gm.person_id
   where gm.group_id = g.id and lower(p.name) = lower(trim(p_name)) and p.pin_hash is not null;
  if not found then return jsonb_build_object('error', 'bad_credentials'); end if;
  if me.locked_until is not null and me.locked_until > now() then
    return jsonb_build_object('error', 'locked');
  end if;
  if p_pin is null or me.pin_hash <> crypt(p_pin, me.pin_hash) then
    attempts := case when me.locked_until is not null and me.locked_until <= now() then 1
                     else me.failed_attempts + 1 end;
    update people
       set failed_attempts = attempts,
           locked_until = case when attempts >= 5 then now() + interval '15 minutes' else null end
     where id = me.id;
    return jsonb_build_object('error', 'bad_credentials');
  end if;
  update people set failed_attempts = 0, locked_until = null where id = me.id;
  return jsonb_build_object('token', _new_session(me.id), 'group_id', g.id);
end $$;
