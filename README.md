# Ježíšek

Rodinné seznamy vánočních přání. Každý napíše aspoň tři dárky (název, cenová
hladina, odkaz kde je sehnat), pozve ostatní odkazem a pak si u nich zaškrtává,
co koupí. Majitel seznamu se **nikdy nedozví**, co z jeho přání už někdo
koupil; ostatní vidí jen „už obsazeno“, ne kdo.

Samostatný repozitář: nesdílí s žádným jiným projektem
soubor, závislost ani službu. Databáze je vlastní Supabase projekt
`jezisek` (`pkhzceugkxjjhhgxnmym`, region eu-central-1).

## Jak to funguje

- **Skupiny.** Aplikace je jeden veřejný odkaz, lidé se nacházejí přes
  skupiny. Kdo začíná, založí skupinu a dostane kód / odkaz pozvánky
  (`#/s/KÓD`). Kdo ho otevře, buď se přihlásí (výběr jména + PIN), nebo se
  zaregistruje (jméno, PIN, aspoň tři dárky). Člověk může být ve více
  skupinách: přidá se dalším kódem v záložce **Já**, nebo si tam založí
  další skupinu s vlastní pozvánkou (třeba pro kolegy, aniž by jim dával
  odkaz na rodinu). Dárky patří člověku, ne skupině, takže všechny skupiny
  vidí stejný seznam a koupený dárek je obsazený všude.
- **Přihlášení** je jméno + PIN (4 až 6 číslic), e-mail s heslem, nebo Google.
  Jméno je jedinečné v rámci skupiny, po pěti špatných PINech je účet 15 minut
  zamčený, relace platí 180 dní. Účet (Supabase Auth) slouží jen k ověření
  totožnosti: klient si vyzvedne JWT, vymění ho ve `session_from_auth` za
  obvyklý token aplikace a dál pracuje po svém. Kdo má PIN, může si účet
  připojit (`link_auth`) a naopak.
- **Dárek** má název, cenovou hladinu (do 1 000 Kč / 1 000 až 3 000 Kč /
  nad 3 000 Kč), odkaz a poznámku. Přidávat a upravovat jde kdykoli; smazat
  jen dárek, který ještě nikdo nekoupil.
- **Koupím to já** označí dárek jako koupený. Jeden kupující na dárek,
  vlastní dárek koupit nejde, označení lze vrátit.
- **Dárky mimo seznam** (tabulka `extra_gifts`): co jsem někomu koupil, i když
  si to nepřál. Zapisují se u člověka v oddílu „Mimo seznam“ nebo z Nákupů
  přes výběr osoby. Vidí je **jen kupující**, obdarovanému se nikde nezobrazí.
- **Lidé mimo aplikaci.** Dárek mimo seznam jde zapsat i na pouhé jméno
  (`extra_gifts.recipient_name` místo `recipient_id`), takže v přehledu nákupů
  je i ten, kdo se do aplikace nikdy nepřihlásí. Až se takový člověk do některé
  mojí skupiny přidá, Nákupy nabídnou propojení (`link_extra_recipient`) a
  zápisy se přesunou k jeho profilu. Tip na propojení vzniká shodou jména nebo
  prvního slova jména; jméno jde i opravit (`rename_extra_recipient`).
- **Nákupy** a karta v záložce **Já** ukazují souhrn: kolik dárků mám pro
  koho, včetně těch mimo seznam, s rozpadem podle cenových hladin. Každý vidí
  jen svoje nákupy.
- **Děti.** Rodič může vést seznam za dítě, které se samo nepřihlašuje. Dítě
  je ve všech skupinách rodiče; rodič jeho seznam upravuje a zároveň (jako
  jeden z kupujících) vidí, co už má kupce.
- **Dítě může mít víc rodičů** (tabulka `child_guardians`). Kterýkoli z nich
  přizve dalšího z lidí ve svých skupinách (`add_guardian`); dítě se objeví i
  v jeho skupinách a oba seznam upravují. `people.managed_by` zůstává jako
  zakladatel a při jeho odchodu přejde na dalšího rodiče. Odebrání sebe sama
  (`remove_child`) profil smaže jen tehdy, když jsem poslední rodič.
- **Správce** (`people.is_admin = true`, nastavuje se ručně v databázi) vidí
  všechny skupiny, může resetovat PIN, smazat člověka nebo skupinu.

## Tisk, stažení a e-mail

Nákupní seznam, přání jednoho člověka i moje vlastní přání se vykreslí do
jednoho HTML dokumentu (`src/export.ts`), který jde vytisknout, stáhnout nebo
poslat e-mailem. Seznam přání nikdy nenese informaci o tom, co je koupené,
takže se dá bez obav poslat dál.

E-maily posílá edge funkce `send-list` přes [Resend](https://resend.com).
HTML skládá až funkce a všechno escapuje, takže přes aplikaci nejde rozeslat
cizí obsah; `register_email_send` v databázi navíc hlídá limit 5 zpráv za
hodinu a 20 za den na člověka.

## Co je potřeba nastavit

V Supabase (projekt `jezisek`):

- **Authentication → URL Configuration**: Site URL na adresu aplikace, do
  Redirect URLs přidat tutéž adresu. Bez toho se odkazy z e-mailů a návrat
  od Googlu vrátí jinam.
- **Authentication → Providers → Google**: zapnout a vložit Client ID a
  Client Secret z Google Cloud (OAuth 2.0 Client, typ Web application,
  Authorized redirect URI `https://<projekt>.supabase.co/auth/v1/callback`).
- **Edge Functions → send-list → Secrets**: `RESEND_API_KEY` z Resendu a
  `JEZISEK_FROM` ve tvaru `Ježíšek <jezisek@tvojedomena.cz>` s ověřenou
  doménou. Dokud chybí, tlačítko Poslat e-mailem vrátí srozumitelnou hlášku
  a zbytek funguje dál.

## Technika

- Frontend: Vite + TypeScript bez frameworku, jeden HTML soubor, hash router.
  Nasazení na Vercel (`vercel.json`).
- Backend: Supabase Postgres. Tabulky jsou pro klienta úplně zavřené (RLS bez
  politik + `revoke`), veškerý přístup jde přes `security definer` funkce
  volané anonymním klíčem s tokenem relace v prvním parametru. Pravidlo
  překvapení tak drží databáze, ne prohlížeč: funkce `person_gifts` vrátí
  majiteli seznamu `taken`/`mine` jako `null`.
- Schéma a funkce: `supabase/migrations/*.sql` (aplikované v pořadí čísel),
  odesílání e-mailů: `supabase/functions/send-list/`.
- Veřejný klíč Supabase v `.env` je určený do prohlížeče; data hlídají funkce
  a oprávnění, ne tajnost klíče.

## Vývoj

```sh
npm install
npm run dev        # http://localhost:5174
npm run build      # tsc --noEmit && vite build → dist/
```

## Nastavení správce

Po první registraci správce v databázi `jezisek`:

```sql
update people set is_admin = true where name = 'Jméno' and pin_hash is not null;
```
