-- Odesílání seznamů e-mailem. Samotné odeslání dělá edge funkce `send-list`
-- přes Resend; databáze hlídá, kdo a kolikrát smí posílat.

create table email_log (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references people(id) on delete cascade,
  to_email   text not null,
  sent_at    timestamptz not null default now()
);
create index email_log_person_idx on email_log(person_id, sent_at);

alter table email_log enable row level security;
revoke all on table email_log from anon, authenticated;

-- Povolí odeslání a rovnou ho zapíše. Limit drží spam na uzdě.
create function register_email_send(p_token text, p_to text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me people := _me(p_token); addr text := lower(trim(coalesce(p_to, ''))); n int;
begin
  if addr = '' then addr := lower(coalesce(me.email, '')); end if;
  if addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'email_invalid'; end if;
  select count(*) into n from email_log where person_id = me.id and sent_at > now() - interval '1 hour';
  if n >= 5 then raise exception 'email_rate_limit'; end if;
  select count(*) into n from email_log where person_id = me.id and sent_at > now() - interval '24 hours';
  if n >= 20 then raise exception 'email_rate_limit'; end if;
  insert into email_log(person_id, to_email) values (me.id, addr);
  return jsonb_build_object('to', addr, 'from_name', me.name);
end $$;

-- Kam se dá poslat bez ptaní: vlastní e-mail z účtu.
create function my_email(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp stable as $$
declare me people := _me(p_token);
begin
  return jsonb_build_object('email', me.email);
end $$;

revoke execute on function register_email_send(text, text), my_email(text)
from public, anon, authenticated;

grant execute on function register_email_send(text, text) to service_role;
grant execute on function my_email(text) to anon;
