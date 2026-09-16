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
- **Přihlášení** je jméno + PIN (4 až 6 číslic), jméno je jedinečné v rámci
  skupiny. Po pěti špatných PINech je účet 15 minut zamčený. Relace platí
  180 dní.
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
- **Správce** (`people.is_admin = true`, nastavuje se ručně v databázi) vidí
  všechny skupiny, může resetovat PIN, smazat člověka nebo skupinu.

## Technika

- Frontend: Vite + TypeScript bez frameworku, jeden HTML soubor, hash router.
  Nasazení na Vercel (`vercel.json`).
- Backend: Supabase Postgres. Tabulky jsou pro klienta úplně zavřené (RLS bez
  politik + `revoke`), veškerý přístup jde přes `security definer` funkce
  volané anonymním klíčem s tokenem relace v prvním parametru. Pravidlo
  překvapení tak drží databáze, ne prohlížeč: funkce `person_gifts` vrátí
  majiteli seznamu `taken`/`mine` jako `null`.
- Schéma a funkce: `supabase/migrations/*.sql` (aplikované v pořadí čísel).
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
