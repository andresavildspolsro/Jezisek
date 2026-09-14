-- Pevná search_path i pro čisté pomocné funkce (doporučení Supabase linteru).
alter function _check_pin(text) set search_path = public, extensions, pg_temp;
alter function _clean_name(text) set search_path = public, extensions, pg_temp;
alter function _clean_url(text) set search_path = public, extensions, pg_temp;
alter function _gift_json(gifts, uuid) set search_path = public, extensions, pg_temp;
