-- Interní pomocné funkce z migrace 0005 zůstaly po vytvoření volatelné
-- zvenčí (Postgres dává nové funkci EXECUTE roli PUBLIC). Klient smí volat
-- jen veřejné API, ne tyhle.
revoke execute on function _extra_json(extra_gifts) from public, anon, authenticated;
revoke execute on function _assert_recipient(people, uuid) from public, anon, authenticated;
