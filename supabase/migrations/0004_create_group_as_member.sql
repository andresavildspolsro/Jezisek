-- Přihlášený člověk může založit další skupinu (další pozvánku), aniž by
-- musel sdílet svou stávající skupinu. Přidá se do ní i se svými dětmi.
create function create_group_as_member(p_token text, p_group_name text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token); g groups;
        gname text := regexp_replace(coalesce(trim(p_group_name), ''), '\s+', ' ', 'g');
begin
  if length(gname) < 1 or length(gname) > 60 then raise exception 'group_name_invalid'; end if;
  insert into groups(name, invite_code) values (gname, _new_invite_code()) returning * into g;
  insert into group_members(group_id, person_id) values (g.id, me.id);
  insert into group_members(group_id, person_id)
    select g.id, id from people where managed_by = me.id;
  return jsonb_build_object('group_id', g.id, 'name', g.name, 'invite_code', g.invite_code);
end $$;

revoke execute on function create_group_as_member(text, text) from public, anon, authenticated;
grant execute on function create_group_as_member(text, text) to anon;
