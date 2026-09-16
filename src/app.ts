// Přihlášená část: lidé ve skupině, seznam jednoho člověka, moje přání,
// moje nákupy, nastavení a správa.

import { api, errorText, sendList, type ExtraGift, type Gift, type GroupRef, type Guardian, type Me, type PersonCard, type Tier } from './api';
import { session } from './state';
import {
  clear,
  confirmSheet,
  daysToChristmas,
  el,
  errorBox,
  field,
  giftFields,
  giftListEditor,
  hostOf,
  initials,
  mount,
  openSheet,
  pinInput,
  plural,
  shareInvite,
  textInput,
  tierPill,
  TIERS,
  toast,
} from './ui';
import { navigate } from './main';
import { downloadDoc, printDoc, purchasesDoc, wishlistDoc, type ExportDoc } from './export';
import { authErrorText, googleUrl, pending, signIn, signUp } from './account';

interface Ctx {
  token: string;
  me: Me;
  group: GroupRef;
}

export async function renderApp(root: HTMLElement, parts: string[]): Promise<void> {
  const token = session.token as string;
  root.appendChild(el('div', { class: 'spinner' }, 'Načítám…'));
  const me = await api.me(token);
  clear(root);

  if (me.groups.length === 0) {
    root.append(noGroupScreen(token, me));
    return;
  }

  const group = me.groups.find((g) => g.id === session.groupId) ?? me.groups[0];
  session.selectGroup(group.id, group.invite_code);
  const ctx: Ctx = { token, me, group };

  const main = el('main', { class: 'wrap stack' });
  root.append(topbar(ctx), main, bottomNav(parts[0] ?? 'lide'));

  switch (parts[0]) {
    case 'osoba':
      await personView(main, ctx, parts[1] ?? '');
      break;
    case 'moje':
      await myListView(main, ctx);
      break;
    case 'nakupy':
      await purchasesView(main, ctx);
      break;
    case 'ja':
      await settingsView(main, ctx);
      break;
    case 'dite':
      addChildView(main, ctx);
      break;
    case 'sprava':
      await adminView(main, ctx);
      break;
    case 'pozvanka':
      inviteView(main, ctx);
      break;
    default:
      await peopleView(main, ctx);
  }
}

// ---------------------------------------------------------------------------
// Kostra
// ---------------------------------------------------------------------------

function topbar(ctx: Ctx): HTMLElement {
  const days = daysToChristmas();
  let groupPicker: HTMLElement;
  if (ctx.me.groups.length > 1) {
    const sel = el('select', { 'aria-label': 'Skupina' });
    for (const g of ctx.me.groups) sel.appendChild(el('option', { value: g.id, selected: g.id === ctx.group.id }, g.name));
    sel.addEventListener('change', () => {
      const g = ctx.me.groups.find((x) => x.id === sel.value);
      if (g) {
        session.selectGroup(g.id, g.invite_code);
        navigate('#/lide');
      }
    });
    groupPicker = sel;
  } else {
    groupPicker = el('span', { class: 'small', style: 'opacity:.9' }, ctx.group.name);
  }
  return el(
    'div',
    { class: 'topbar' },
    el(
      'div',
      { class: 'wrap' },
      el('span', { class: 'brand' }, '🎁 Ježíšek'),
      groupPicker,
      el('span', { class: 'spacer' }),
      el('span', { class: 'countdown' }, days === 0 ? 'Dnes je Štědrý den!' : `${days} ${plural(days, 'den', 'dny', 'dní')} do Vánoc`),
    ),
  );
}

function bottomNav(active: string): HTMLElement {
  const items: [string, string, string, string[]][] = [
    ['#/lide', '👨‍👩‍👧', 'Lidé', ['lide', 'osoba']],
    ['#/moje', '📝', 'Moje přání', ['moje', 'dite']],
    ['#/nakupy', '🛍️', 'Nákupy', ['nakupy']],
    ['#/ja', '⚙️', 'Já', ['ja', 'sprava']],
  ];
  return el(
    'nav',
    { class: 'nav' },
    ...items.map(([href, ico, label, keys]) =>
      el(
        'a',
        { href, 'aria-current': keys.includes(active) ? 'page' : null },
        el('span', { class: 'ico', 'aria-hidden': 'true' }, ico),
        label,
      ),
    ),
  );
}

function noGroupScreen(token: string, me: Me): HTMLElement {
  const code = textInput({ placeholder: 'Kód z pozvánky', autocapitalize: 'characters', maxLength: 8 });
  const err = el('div');
  return el(
    'main',
    { class: 'wrap plain stack', style: 'padding-top:32px' },
    el(
      'div',
      { class: 'card stack' },
      el('h2', {}, `Ahoj, ${me.name}`),
      el('p', { class: 'muted' }, 'Nejsi v žádné skupině. Zadej kód z pozvánky, nebo se odhlas.'),
      err,
      el(
        'div',
        { class: 'row' },
        el('div', { class: 'grow' }, code),
        el(
          'button',
          {
            class: 'btn',
            onClick: async () => {
              clear(err);
              try {
                const r = await api.joinGroup(token, code.value);
                session.selectGroup(r.group_id, code.value);
                navigate('#/lide');
              } catch (e) {
                err.appendChild(errorBox(errorText(e)));
              }
            },
          },
          'Přidat se',
        ),
      ),
      el('button', { class: 'btn ghost block', onClick: () => logout(token) }, 'Odhlásit se'),
    ),
  );
}

async function logout(token: string): Promise<void> {
  try {
    await api.logout(token);
  } catch {
    /* relace stejně končí lokálně */
  }
  session.end();
  navigate('#/');
}

/** Kód a odkaz na pozvánku do aktuální skupiny. */
function inviteView(main: HTMLElement, ctx: Ctx): void {
  mount(
    main,
    el(
      'div',
      { class: 'card stack center', style: 'margin-top:8px' },
      el('span', { style: 'font-size:2.4rem', 'aria-hidden': 'true' }, '🎄'),
      el('h2', {}, `Skupina „${ctx.group.name}“ je založená`),
      el('p', { class: 'muted' }, 'Pošli rodině odkaz. Kdo ho otevře, napíše svoje přání a hned vidí ta tvoje.'),
      el('div', { class: 'code' }, ctx.group.invite_code),
      el('button', { class: 'btn block', onClick: () => void shareInvite(ctx.group.name, ctx.group.invite_code) }, 'Sdílet pozvánku'),
      el('a', { class: 'btn secondary block', href: '#/lide' }, 'Pokračovat do aplikace'),
    ),
  );
}

function spinner(text = 'Načítám…'): HTMLElement {
  return el('div', { class: 'spinner' }, text);
}

function emptyState(emoji: string, text: string, ...actions: HTMLElement[]): HTMLElement {
  return el('div', { class: 'card empty stack' }, el('span', { class: 'emoji', 'aria-hidden': 'true' }, emoji), el('p', {}, text), ...actions);
}

// ---------------------------------------------------------------------------
// Lidé ve skupině
// ---------------------------------------------------------------------------

async function peopleView(main: HTMLElement, ctx: Ctx): Promise<void> {
  mount(main, 
    el('div', { class: 'section-title' }, el('h2', {}, 'Komu nadělíš?'), el('span', { class: 'muted small' }, ctx.group.name)),
    spinner(),
  );
  const people = await api.groupPeople(ctx.token, ctx.group.id);
  main.querySelector('.spinner')?.remove();

  if (people.length === 0) {
    mount(main, 
      emptyState(
        '🎄',
        'Zatím tu jsi jen ty. Pošli rodině pozvánku a jejich přání se tu objeví.',
        el('button', { class: 'btn', onClick: () => void shareInvite(ctx.group.name, ctx.group.invite_code) }, 'Sdílet pozvánku'),
      ),
    );
  } else {
    mount(main, el('div', { class: 'stack' }, ...people.map((p) => personCard(p))));
  }

  mount(main, 
    el(
      'div',
      { class: 'card tight row between' },
      el('div', {}, el('div', { class: 'small', style: 'font-weight:600' }, 'Chybí tu někdo?'), el('div', { class: 'muted small' }, `Kód skupiny: ${ctx.group.invite_code}`)),
      el('button', { class: 'btn secondary small', onClick: () => void shareInvite(ctx.group.name, ctx.group.invite_code) }, 'Pozvat'),
    ),
  );
}

function personCard(p: PersonCard): HTMLElement {
  const bought = p.gift_count - p.free_count;
  const status =
    p.gift_count === 0
      ? 'zatím bez přání'
      : p.free_count === 0
        ? `všech ${p.gift_count} přání už má kupce`
        : `${p.free_count} ${plural(p.free_count, 'volné přání', 'volná přání', 'volných přání')} z ${p.gift_count}`;
  return el(
    'a',
    { class: 'card clickable person-card', href: `#/osoba/${p.id}` },
    el('span', { class: `avatar ${p.is_child ? 'child' : ''}`.trim(), 'aria-hidden': 'true' }, initials(p.name)),
    el(
      'div',
      { class: 'grow' },
      el(
        'div',
        { class: 'row', style: 'gap:8px' },
        el('span', { class: 'name' }, p.name),
        p.managed_by_me ? el('span', { class: 'pill gold' }, 'moje dítě') : p.is_child ? el('span', { class: 'pill grey' }, 'dítě') : null,
      ),
      el('div', { class: 'muted small' }, status, bought > 0 && p.free_count > 0 ? '' : ''),
    ),
    el('span', { class: 'chev', 'aria-hidden': 'true' }, '›'),
  );
}

// ---------------------------------------------------------------------------
// Seznam jednoho člověka
// ---------------------------------------------------------------------------

async function personView(main: HTMLElement, ctx: Ctx, personId: string): Promise<void> {
  mount(main, spinner());
  const data = await api.personGifts(ctx.token, personId);
  clear(main);
  if (data.person.is_me) {
    navigate('#/moje');
    return;
  }
  const p = data.person;
  const canEdit = p.managed_by_me;

  const list = el('div', { class: 'stack' });
  const extrasBox = el('div', { class: 'stack' });
  const guardiansBox = el('div', { class: 'stack' });
  const refresh = async () => {
    const fresh = await api.personGifts(ctx.token, personId);
    clear(list);
    renderGifts(fresh.gifts);
    renderExtras(fresh.extras);
    renderGuardians(fresh.person.guardians);
    summary.textContent = summaryText(fresh.gifts, fresh.extras);
  };
  const renderGuardians = (guardians: Guardian[]) => {
    clear(guardiansBox);
    if (!canEdit) return;
    mount(
      guardiansBox,
      el(
        'div',
        { class: 'card stack' },
        el('h3', {}, guardians.length > 1 ? 'Rodiče' : 'Rodič'),
        el('p', { class: 'muted small' }, 'Kdo tu smí upravovat seznam přání. Všichni vidí i to, co už je koupené.'),
        ...guardians.map((g) =>
          el(
            'div',
            { class: 'row between' },
            el('span', { style: 'font-weight:600' }, g.id === ctx.me.id ? `${g.name} (ty)` : g.name),
            guardians.length > 1
              ? el(
                  'button',
                  {
                    class: 'btn ghost small',
                    style: 'color:var(--red)',
                    onClick: async () => {
                      const self = g.id === ctx.me.id;
                      const ok = await confirmSheet(
                        self ? 'Přestat spravovat?' : 'Odebrat rodiče?',
                        self
                          ? `Seznam ti zmizí z Moje přání. ${guardians.filter((x) => x.id !== g.id).map((x) => x.name).join(', ')} ho spravuje dál.`
                          : `${g.name} už nebude moct seznam upravovat.`,
                        'Odebrat',
                        true,
                      );
                      if (!ok) return;
                      try {
                        await api.removeGuardian(ctx.token, personId, g.id);
                        toast('Hotovo.');
                        if (self) navigate('#/lide');
                        else await refresh();
                      } catch (ex) {
                        toast(errorText(ex), true);
                      }
                    },
                  },
                  'Odebrat',
                )
              : null,
          ),
        ),
        el(
          'button',
          { class: 'btn secondary block', onClick: () => addGuardianSheet(ctx, personId, p.name, guardians, refresh) },
          '+ Přidat dalšího rodiče',
        ),
      ),
    );
  };
  const renderExtras = (extras: ExtraGift[]) => {
    clear(extrasBox);
    mount(
      extrasBox,
      el(
        'div',
        { class: 'section-title' },
        el('h3', {}, 'Mimo seznam'),
        el('span', { class: 'pill gold' }, 'vidíš jen ty'),
      ),
      extras.length === 0
        ? el('p', { class: 'muted small' }, 'Máš navíc něco, co v seznamu přání není? Zapiš si to, ať máš přehled o všech dárcích. Nikdo jiný to neuvidí.')
        : el('div', { class: 'stack' }, ...extras.map((e) => extraRow(ctx, e, refresh, false))),
      el(
        'button',
        { class: 'btn secondary block', onClick: () => extraSheet(ctx, { id: p.id, name: p.name }, null, refresh) },
        '+ Přidat dárek mimo seznam',
      ),
    );
  };
  const renderGifts = (gifts: Gift[]) => {
    if (gifts.length === 0) {
      list.appendChild(emptyState('🤷', 'Tady zatím žádné přání není.'));
      return;
    }
    for (const g of gifts) list.appendChild(giftRow(ctx, g, { claimable: true, editable: canEdit, ownerId: personId, onChange: refresh }));
  };
  const summaryText = (gifts: Gift[], extras: ExtraGift[]) => {
    const n = gifts.length;
    const t = gifts.filter((g) => g.taken).length;
    const mine = gifts.filter((g) => g.mine).length + extras.length;
    const base = n === 0 ? 'Zatím bez přání.' : t === 0 ? `${n} ${plural(n, 'přání', 'přání', 'přání')}, zatím nic není koupené.` : `${t} z ${n} přání už má kupce.`;
    return mine > 0 ? `${base} Od tebe přinese Ježíšek ${mine} ${plural(mine, 'dárek', 'dárky', 'dárků')}.` : base;
  };
  const summary = el('p', { class: 'muted small' }, summaryText(data.gifts, data.extras));

  renderGifts(data.gifts);
  renderExtras(data.extras);
  renderGuardians(p.guardians);

  mount(main, 
    el(
      'div',
      { class: 'row between' },
      el('a', { class: 'btn ghost small', href: '#/lide' }, '‹ Lidé'),
      el(
        'button',
        {
          class: 'btn ghost small',
          onClick: () =>
            exportSheet(ctx, 'Seznam přání', 'Dokument neobsahuje, co je koupené, takže ho můžeš poslat komukoli dál.', async () => {
              const fresh = await api.personGifts(ctx.token, personId);
              return wishlistDoc(fresh.person.name, fresh.gifts, false);
            }),
        },
        '⭳ Tisk',
      ),
    ),
    el(
      'div',
      { class: 'row' },
      el('span', { class: `avatar ${p.is_child ? 'child' : ''}`.trim(), 'aria-hidden': 'true' }, initials(p.name)),
      el('div', {}, el('h2', {}, p.name), summary),
    ),
    canEdit ? el('div', { class: 'notice' }, 'Toto je seznam tvého dítěte: můžeš ho upravovat a zároveň vidíš, co už má kupce.') : null,
    list,
    canEdit
      ? el('button', { class: 'btn secondary block', onClick: () => giftSheet(ctx, personId, null, refresh) }, '+ Přidat přání')
      : null,
    extrasBox,
    guardiansBox,
  );
}

/** Přizve dalšího rodiče ke správě seznamu dítěte. */
function addGuardianSheet(
  ctx: Ctx,
  childId: string,
  childName: string,
  guardians: Guardian[],
  onDone: () => Promise<void> | void,
): void {
  const picker = el('select', { class: 'input' }, el('option', { value: '' }, 'Načítám lidi…'));
  const err = el('div');
  void api
    .myRecipients(ctx.token)
    .then((people) => {
      const free = people.filter((r) => !r.is_child && !guardians.some((g) => g.id === r.id));
      clear(picker);
      if (free.length === 0) {
        mount(picker, el('option', { value: '' }, 'Nikdo další tu není'));
        mount(err, errorBox('Druhý rodič musí být ve stejné skupině jako ty. Pošli mu nejdřív pozvánku.'));
        return;
      }
      mount(picker, el('option', { value: '' }, 'Vyber člověka…'), ...free.map((r) => el('option', { value: r.id }, r.name)));
    })
    .catch((e) => {
      clear(err);
      mount(err, errorBox(errorText(e)));
    });

  const save = el(
    'button',
    {
      class: 'btn',
      onClick: async () => {
        clear(err);
        if (!picker.value) {
          mount(err, errorBox('Vyber člověka.'));
          return;
        }
        save.disabled = true;
        try {
          await api.addGuardian(ctx.token, childId, picker.value);
          close();
          toast('Přidáno, seznam teď spravujete spolu.');
          await onDone();
        } catch (ex) {
          mount(err, errorBox(errorText(ex)));
          save.disabled = false;
        }
      },
    },
    'Přidat',
  );

  const close = openSheet([
    el('h2', {}, `Další rodič pro ${childName}`),
    el('p', { class: 'muted small' }, 'Bude moct přidávat a upravovat přání a uvidí, co už je koupené. Dítě se objeví i v jeho skupinách.'),
    field('Kdo', picker),
    err,
    el('div', { class: 'row', style: 'justify-content:flex-end' }, el('button', { class: 'btn secondary', onClick: () => close() }, 'Zpět'), save),
  ]);
}

/** Karta dárku mimo seznam. Zobrazuje se jen tomu, kdo ho zapsal. */
function extraRow(ctx: Ctx, e: ExtraGift, onChange: () => Promise<void> | void, badge = true): HTMLElement {
  return el(
    'div',
    { class: 'card tight gift' },
    el(
      'div',
      { class: 'body' },
      el('div', { class: 'title' }, e.title),
      el(
        'div',
        { class: 'meta' },
        tierPill(e.tier),
        badge ? el('span', { class: 'pill gold' }, 'mimo seznam') : null,
        e.url ? el('a', { class: 'link-out', href: e.url, target: '_blank', rel: 'noopener noreferrer' }, `${hostOf(e.url)} ↗`) : null,
      ),
      e.note ? el('div', { class: 'note' }, e.note) : null,
    ),
    el(
      'div',
      { class: 'actions' },
      el(
        'div',
        { class: 'row', style: 'gap:2px' },
        el('button', { class: 'btn ghost small', onClick: () => extraSheet(ctx, null, e, onChange) }, 'Upravit'),
        el(
          'button',
          {
            class: 'btn ghost small',
            style: 'color:var(--red)',
            onClick: async () => {
              if (!(await confirmSheet('Smazat poznámku?', `„${e.title}“ zmizí z tvého přehledu nákupů.`, 'Smazat', true))) return;
              try {
                await api.deleteExtraGift(ctx.token, e.id);
                toast('Smazáno.');
                await onChange();
              } catch (ex) {
                toast(errorText(ex), true);
              }
            },
          },
          'Smazat',
        ),
      ),
    ),
  );
}

/**
 * Dialog pro dárek mimo seznam. `person` předvyplní obdarovaného, jinak se
 * nabídne výběr; `existing` přepne dialog na úpravu.
 */
function extraSheet(
  ctx: Ctx,
  person: { id: string; name: string } | null,
  existing: ExtraGift | null,
  onDone: () => Promise<void> | void,
): void {
  const f = giftFields(existing ?? undefined);
  const err = el('div');
  const OFF_APP = '__mimo__';
  const picker = el('select', { class: 'input' }, el('option', { value: '' }, 'Načítám lidi…'));
  const offAppName = textInput({ placeholder: 'Jméno, např. babička Marie', maxLength: 40 });
  const offAppField = field('Kdo to je', offAppName, 'Až se přidá do skupiny, půjde zápis propojit s jeho profilem.');
  offAppField.hidden = true;
  const needsPicker = !person && !existing;
  picker.addEventListener('change', () => {
    offAppField.hidden = picker.value !== OFF_APP;
    if (!offAppField.hidden) offAppName.focus();
  });
  if (needsPicker) {
    void api
      .myRecipients(ctx.token)
      .then((people) => {
        clear(picker);
        mount(
          picker,
          el('option', { value: '' }, 'Vyber, komu jsi dárek koupil…'),
          ...people.map((r) => el('option', { value: r.id }, r.is_child ? `${r.name} (dítě)` : r.name)),
          el('option', { value: OFF_APP }, 'Někdo, kdo v aplikaci není…'),
        );
      })
      .catch((e) => {
        clear(err);
        mount(err, errorBox(errorText(e)));
      });
  }

  const save = el(
    'button',
    {
      class: 'btn',
      onClick: async () => {
        clear(err);
        const v = f.read();
        if (!v.ok || !v.value) {
          mount(err, errorBox(v.problem ?? 'Zkontroluj údaje.'));
          return;
        }
        const chosen = person?.id ?? picker.value;
        const offApp = !person && chosen === OFF_APP;
        if (!existing && !chosen) {
          mount(err, errorBox('Vyber, komu jsi dárek koupil.'));
          return;
        }
        if (offApp && !offAppName.value.trim()) {
          mount(err, errorBox('Napiš jméno člověka, kterému jsi dárek koupil.'));
          offAppName.focus();
          return;
        }
        save.disabled = true;
        try {
          if (existing) await api.updateExtraGift(ctx.token, existing.id, v.value);
          else if (offApp) await api.addExtraGift(ctx.token, null, offAppName.value, v.value);
          else await api.addExtraGift(ctx.token, chosen, null, v.value);
          close();
          toast(existing ? 'Upraveno.' : 'Zapsáno do tvých nákupů.');
          await onDone();
        } catch (ex) {
          mount(err, errorBox(errorText(ex)));
          save.disabled = false;
        }
      },
    },
    existing ? 'Uložit' : 'Zapsat',
  );

  const close = openSheet([
    el('h2', {}, existing ? 'Upravit dárek mimo seznam' : 'Dárek mimo seznam'),
    el('p', { class: 'muted small' }, 'Dárek, který v seznamu přání není, ale ty ho máš. Vidíš ho jen ty.'),
    person ? el('p', { class: 'small' }, 'Pro: ', el('strong', {}, person.name)) : null,
    needsPicker ? field('Pro koho', picker) : null,
    needsPicker ? offAppField : null,
    f.root,
    err,
    el('div', { class: 'row', style: 'justify-content:flex-end' }, el('button', { class: 'btn secondary', onClick: () => close() }, 'Zpět'), save),
  ]);
  setTimeout(() => (needsPicker ? picker.focus() : f.focus()), 50);
}

interface GiftRowOpts {
  claimable: boolean;
  editable: boolean;
  ownerId: string;
  onChange: () => Promise<void> | void;
}

function giftRow(ctx: Ctx, g: Gift, o: GiftRowOpts): HTMLElement {
  const actions = el('div', { class: 'actions' });
  const busy = (fn: () => Promise<void>) => async (e: Event) => {
    const b = e.currentTarget as HTMLButtonElement;
    b.disabled = true;
    try {
      await fn();
      await o.onChange();
    } catch (ex) {
      toast(errorText(ex), true);
      b.disabled = false;
    }
  };

  if (o.claimable) {
    if (g.mine) {
      actions.append(
        el('button', { class: 'btn gold small', onClick: busy(async () => { await api.unclaimGift(ctx.token, g.id); toast('Dárek je zase volný.'); }) }, '✓ Koupím já'),
        el('span', { class: 'muted small' }, 'klepnutím vrátíš'),
      );
    } else if (g.taken) {
      actions.appendChild(el('span', { class: 'pill grey' }, 'Už obsazeno'));
    } else {
      actions.appendChild(
        el('button', { class: 'btn small', onClick: busy(async () => { await api.claimGift(ctx.token, g.id); toast('Zapsáno. Ježíšek děkuje! 🎅'); }) }, 'Koupím to já'),
      );
    }
  }
  if (o.editable) {
    actions.append(
      el(
        'div',
        { class: 'row', style: 'gap:2px' },
        el('button', { class: 'btn ghost small', onClick: () => giftSheet(ctx, o.ownerId, g, o.onChange) }, 'Upravit'),
        el(
          'button',
          {
            class: 'btn ghost small',
            style: 'color:var(--red)',
            onClick: async () => {
              if (!(await confirmSheet('Smazat přání?', `„${g.title}“ zmizí ze seznamu.`, 'Smazat', true))) return;
              try {
                await api.deleteGift(ctx.token, g.id);
                toast('Přání smazáno.');
                await o.onChange();
              } catch (ex) {
                toast(errorText(ex), true);
              }
            },
          },
          'Smazat',
        ),
      ),
    );
  }

  return el(
    'div',
    { class: `card tight gift ${o.claimable && g.taken && !g.mine ? 'taken' : ''}`.trim() },
    el(
      'div',
      { class: 'body' },
      el('div', { class: 'title' }, g.title),
      el(
        'div',
        { class: 'meta' },
        tierPill(g.tier),
        g.url ? el('a', { class: 'link-out', href: g.url, target: '_blank', rel: 'noopener noreferrer' }, `${hostOf(g.url)} ↗`) : null,
      ),
      g.note ? el('div', { class: 'note' }, g.note) : null,
    ),
    actions,
  );
}

/** Dialog pro přidání nebo úpravu jednoho přání. */
function giftSheet(ctx: Ctx, ownerId: string, existing: Gift | null, onDone: () => Promise<void> | void): void {
  const f = giftFields(existing ?? undefined);
  const err = el('div');
  const save = el(
    'button',
    {
      class: 'btn',
      onClick: async () => {
        clear(err);
        const v = f.read();
        if (!v.ok || !v.value) {
          err.appendChild(errorBox(v.problem ?? 'Zkontroluj údaje.'));
          return;
        }
        save.disabled = true;
        try {
          if (existing) await api.updateGift(ctx.token, existing.id, v.value);
          else await api.addGift(ctx.token, ownerId, v.value);
          close();
          toast(existing ? 'Přání upraveno.' : 'Přání přidáno.');
          await onDone();
        } catch (ex) {
          err.appendChild(errorBox(errorText(ex)));
          save.disabled = false;
        }
      },
    },
    existing ? 'Uložit' : 'Přidat',
  );
  const close = openSheet([
    el('h2', {}, existing ? 'Upravit přání' : 'Nové přání'),
    f.root,
    err,
    el('div', { class: 'row', style: 'justify-content:flex-end' }, el('button', { class: 'btn secondary', onClick: () => close() }, 'Zpět'), save),
  ]);
  setTimeout(() => f.focus(), 50);
}

// ---------------------------------------------------------------------------
// Moje přání
// ---------------------------------------------------------------------------

async function myListView(main: HTMLElement, ctx: Ctx): Promise<void> {
  mount(
    main,
    el(
      'div',
      { class: 'section-title' },
      el('h2', {}, 'Moje přání'),
      el(
        'button',
        {
          class: 'btn ghost small',
          onClick: () =>
            exportSheet(ctx, 'Můj seznam přání', 'Pro někoho, kdo aplikaci nepoužívá. Co je koupené, v dokumentu není.', async () => {
              const fresh = await api.personGifts(ctx.token, ctx.me.id);
              return wishlistDoc(ctx.me.name, fresh.gifts, true);
            }),
        },
        '⭳ Tisk',
      ),
    ),
    spinner(),
  );
  const data = await api.personGifts(ctx.token, ctx.me.id);
  main.querySelector('.spinner')?.remove();

  const list = el('div', { class: 'stack' });
  const refresh = async () => {
    const fresh = await api.personGifts(ctx.token, ctx.me.id);
    clear(list);
    render(fresh.gifts);
  };
  const render = (gifts: Gift[]) => {
    if (gifts.length === 0) list.appendChild(emptyState('📝', 'Zatím žádné přání. Přidej první.'));
    for (const g of gifts) list.appendChild(giftRow(ctx, g, { claimable: false, editable: true, ownerId: ctx.me.id, onChange: refresh }));
  };
  render(data.gifts);

  mount(main, 
    el('p', { class: 'muted small' }, 'Kdo ti co koupí, tady neuvidíš. V tom je to kouzlo. 🎄 Přidávat a upravovat můžeš kdykoli.'),
    list,
    el('button', { class: 'btn secondary block', onClick: () => giftSheet(ctx, ctx.me.id, null, refresh) }, '+ Přidat přání'),
    el(
      'div',
      { class: 'section-title' },
      el('h2', {}, 'Děti, které spravuji'),
      el('a', { class: 'btn ghost small', href: '#/dite' }, '+ Přidat dítě'),
    ),
    ctx.me.children.length === 0
      ? el('p', { class: 'muted small' }, 'Píšeš seznam za někoho, kdo se sám nepřihlásí? Přidej ho jako dítě. Jeho přání uvidí všichni v tvých skupinách.')
      : el(
          'div',
          { class: 'stack' },
          ...ctx.me.children.map((c) =>
            el(
              'a',
              { class: 'card clickable person-card', href: `#/osoba/${c.id}` },
              el('span', { class: 'avatar child', 'aria-hidden': 'true' }, initials(c.name)),
              el(
                'div',
                { class: 'grow' },
                el('div', { class: 'name' }, c.name),
                el('div', { class: 'muted small' }, coGuardianText(c.guardians, ctx.me.id) || 'upravit seznam'),
              ),
              el('span', { class: 'chev', 'aria-hidden': 'true' }, '›'),
            ),
          ),
        ),
  );
}

function addChildView(main: HTMLElement, ctx: Ctx): void {
  const err = el('div');
  const name = textInput({ placeholder: 'Jméno dítěte', maxLength: 40 });
  const gifts = giftListEditor(3);
  const btn = el('button', { class: 'btn block', type: 'submit' }, 'Uložit dítě a jeho přání');
  const submit = async (e: Event) => {
    e.preventDefault();
    clear(err);
    if (!name.value.trim()) {
      err.appendChild(errorBox('Napiš jméno dítěte.'));
      name.focus();
      return;
    }
    const g = gifts.read();
    if (!g.ok) {
      err.appendChild(errorBox(g.problem ?? 'Zkontroluj dárky.'));
      err.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    btn.disabled = true;
    try {
      const r = await api.addChild(ctx.token, name.value, g.gifts);
      toast(`${r.name} má svůj seznam.`);
      navigate(`#/osoba/${r.id}`);
    } catch (ex) {
      err.appendChild(errorBox(errorText(ex)));
      err.scrollIntoView({ behavior: 'smooth', block: 'center' });
      btn.disabled = false;
    }
  };
  mount(main, 
    el('a', { class: 'btn ghost small', href: '#/moje', style: 'align-self:flex-start' }, '‹ Moje přání'),
    el('h2', {}, 'Nové dítě'),
    el('p', { class: 'muted small' }, 'Dítě se samo nepřihlašuje, seznam za něj vedeš ty. Bude ve všech skupinách, kde jsi ty.'),
    el(
      'form',
      { class: 'stack', onSubmit: submit },
      el('div', { class: 'card stack' }, field('Jméno', name, `Musí být ve skupině jedinečné, třeba „Tomík“ nebo „Anička N.“`)),
      el('div', { class: 'card stack' }, el('h3', {}, 'Co si přeje'), gifts.root),
      err,
      btn,
    ),
  );
}

// ---------------------------------------------------------------------------
// Moje nákupy
// ---------------------------------------------------------------------------

/** Rozpad podle cenových hladin, například „2× do 1 000 Kč · 1× nad 3 000 Kč“. */
/**
 * „druhý rodič: Bedřich“, nebo prázdno, když je dítě jen moje. Jména se
 * nikdy neskloňují, proto stojí za dvojtečkou.
 */
function coGuardianText(guardians: Guardian[], meId: string): string {
  const others = guardians.filter((g) => g.id !== meId).map((g) => g.name);
  if (others.length === 0) return '';
  return `${others.length === 1 ? 'druhý rodič' : 'další rodiče'}: ${others.join(', ')}`;
}

function tierBreakdown(items: { tier: Tier }[]): string {
  return TIERS.map((t) => ({ ...t, n: items.filter((g) => g.tier === t.tier).length }))
    .filter((t) => t.n > 0)
    .map((t) => `${t.n}× ${t.label}`)
    .join(' · ');
}

function giftCount(n: number): string {
  return `${n} ${plural(n, 'dárek', 'dárky', 'dárků')}`;
}

async function purchasesView(main: HTMLElement, ctx: Ctx): Promise<void> {
  mount(
    main,
    el(
      'div',
      { class: 'section-title' },
      el('h2', {}, 'Moje nákupy'),
      el(
        'button',
        {
          class: 'btn ghost small',
          onClick: () =>
            exportSheet(ctx, 'Nákupní seznam', 'Vytiskni si ho na cestu do obchodu, nebo si ho ulož. Vidí ho jen ty.', async () =>
              purchasesDoc(await api.myPurchases(ctx.token)),
            ),
        },
        '⭳ Tisk',
      ),
    ),
    spinner(),
  );
  const body = el('div', { class: 'stack' });
  const load = async () => {
    const purchases = await api.myPurchases(ctx.token);
    clear(body);
    const all = purchases.flatMap((p) => [...p.gifts, ...p.extras]);
    const addExtra = el(
      'button',
      { class: 'btn secondary block', onClick: () => extraSheet(ctx, null, null, load) },
      '+ Dárek mimo seznam',
    );
    if (all.length === 0) {
      mount(
        body,
        emptyState('🛍️', 'Zatím nic. Projdi seznamy lidí a zaškrtni, co koupíš.', el('a', { class: 'btn', href: '#/lide' }, 'Na lidi')),
        addExtra,
      );
      return;
    }
    body.append(
      el(
        'div',
        { class: 'card tight row between' },
        el(
          'div',
          { class: 'grow' },
          el('strong', {}, `${giftCount(all.length)} pro ${purchases.length} ${plural(purchases.length, 'člověka', 'lidi', 'lidí')}`),
          el('div', { class: 'muted small' }, tierBreakdown(all)),
        ),
        el('span', { 'aria-hidden': 'true', style: 'font-size:1.6rem' }, '🎅'),
      ),
      ...purchases.map((p) =>
        el(
          'div',
          { class: 'stack' },
          el(
            'div',
            { class: 'section-title' },
            el(
              'div',
              {},
              el(
                'div',
                { class: 'row', style: 'gap:8px' },
                el('h3', {}, p.person_name),
                p.off_app ? el('span', { class: 'pill grey' }, 'není v aplikaci') : null,
              ),
              el('div', { class: 'muted small' }, `${giftCount(p.gifts.length + p.extras.length)} · ${tierBreakdown([...p.gifts, ...p.extras])}`),
            ),
            p.off_app ? null : el('a', { class: 'small', href: `#/osoba/${p.person_id}` }, 'celý seznam'),
          ),
          p.off_app && p.suggestions.length > 0
            ? el(
                'div',
                { class: 'notice row between' },
                el('span', {}, 'V aplikaci je ', el('strong', {}, p.suggestions[0].name), '. Je to stejný člověk?'),
                el(
                  'button',
                  {
                    class: 'btn small',
                    onClick: async () => {
                      try {
                        await api.linkExtraRecipient(ctx.token, p.person_name, p.suggestions[0].id);
                        toast('Propojeno.');
                        await load();
                      } catch (ex) {
                        toast(errorText(ex), true);
                      }
                    },
                  },
                  'Propojit',
                ),
              )
            : null,
          ...p.gifts.map((g) =>
            el(
              'div',
              { class: 'card tight gift' },
              el(
                'div',
                { class: 'body' },
                el('div', { class: 'title' }, g.title),
                el('div', { class: 'meta' }, tierPill(g.tier), g.url ? el('a', { class: 'link-out', href: g.url, target: '_blank', rel: 'noopener noreferrer' }, `${hostOf(g.url)} ↗`) : null),
                g.note ? el('div', { class: 'note' }, g.note) : null,
              ),
              el(
                'div',
                { class: 'actions' },
                el(
                  'button',
                  {
                    class: 'btn ghost small',
                    onClick: async () => {
                      if (!(await confirmSheet('Vrátit dárek?', `„${g.title}“ bude zase volný pro ostatní.`, 'Vrátit'))) return;
                      try {
                        await api.unclaimGift(ctx.token, g.id);
                        toast('Dárek je zase volný.');
                        await load();
                      } catch (ex) {
                        toast(errorText(ex), true);
                      }
                    },
                  },
                  'Vrátit',
                ),
              ),
            ),
          ),
          ...p.extras.map((e) => extraRow(ctx, e, load)),
          p.off_app
            ? el(
                'div',
                { class: 'row' },
                el('button', { class: 'btn ghost small', onClick: () => linkRecipientSheet(ctx, p.person_name, p.suggestions, load) }, 'Propojit s člověkem'),
                el('button', { class: 'btn ghost small', onClick: () => renameRecipientSheet(ctx, p.person_name, load) }, 'Přejmenovat'),
              )
            : null,
        ),
      ),
      addExtra,
    );
  };
  await load();
  main.querySelector('.spinner')?.remove();
  mount(main, body);
}

/** Propojí jméno zvenčí s člověkem, který se mezitím do skupiny přidal. */
function linkRecipientSheet(
  ctx: Ctx,
  name: string,
  suggestions: { id: string; name: string }[],
  onDone: () => Promise<void> | void,
): void {
  const picker = el('select', { class: 'input' }, el('option', { value: '' }, 'Načítám lidi…'));
  const err = el('div');
  void api
    .myRecipients(ctx.token)
    .then((people) => {
      clear(picker);
      mount(
        picker,
        el('option', { value: '' }, 'Vyber člověka…'),
        ...people.map((r) =>
          el('option', { value: r.id, selected: suggestions.some((sg) => sg.id === r.id) }, r.is_child ? `${r.name} (dítě)` : r.name),
        ),
      );
    })
    .catch((e) => {
      clear(err);
      mount(err, errorBox(errorText(e)));
    });

  const save = el(
    'button',
    {
      class: 'btn',
      onClick: async () => {
        clear(err);
        if (!picker.value) {
          mount(err, errorBox('Vyber člověka.'));
          return;
        }
        save.disabled = true;
        try {
          const r = await api.linkExtraRecipient(ctx.token, name, picker.value);
          close();
          toast(`Propojeno, ${giftCount(r.linked)} se přesunul${r.linked === 1 ? '' : 'y'}.`);
          await onDone();
        } catch (ex) {
          mount(err, errorBox(errorText(ex)));
          save.disabled = false;
        }
      },
    },
    'Propojit',
  );

  const close = openSheet([
    el('h2', {}, `Propojit „${name}“`),
    el('p', { class: 'muted small' }, 'Dárky zapsané na tohle jméno se přesunou k vybranému člověku. Uvidíš je pak u něj, jemu se dál nezobrazí.'),
    field('S kým', picker),
    err,
    el('div', { class: 'row', style: 'justify-content:flex-end' }, el('button', { class: 'btn secondary', onClick: () => close() }, 'Zpět'), save),
  ]);
}

/** Oprava jména u člověka mimo aplikaci. */
function renameRecipientSheet(ctx: Ctx, name: string, onDone: () => Promise<void> | void): void {
  const input = textInput({ value: name, maxLength: 40 });
  const err = el('div');
  const save = el(
    'button',
    {
      class: 'btn',
      onClick: async () => {
        clear(err);
        if (!input.value.trim()) {
          mount(err, errorBox('Napiš jméno.'));
          return;
        }
        save.disabled = true;
        try {
          await api.renameExtraRecipient(ctx.token, name, input.value);
          close();
          toast('Přejmenováno.');
          await onDone();
        } catch (ex) {
          mount(err, errorBox(errorText(ex)));
          save.disabled = false;
        }
      },
    },
    'Uložit',
  );
  const close = openSheet([
    el('h2', {}, 'Přejmenovat'),
    field('Jméno', input),
    err,
    el('div', { class: 'row', style: 'justify-content:flex-end' }, el('button', { class: 'btn secondary', onClick: () => close() }, 'Zpět'), save),
  ]);
  setTimeout(() => input.focus(), 50);
}

/** Nabídne tisk, stažení nebo odeslání hotového seznamu e-mailem. */
function exportSheet(ctx: Ctx, title: string, note: string, build: () => Promise<ExportDoc>): void {
  const err = el('div');
  const run = (fn: (doc: ExportDoc) => void) => async (e: Event) => {
    const b = e.currentTarget as HTMLButtonElement;
    b.disabled = true;
    clear(err);
    try {
      fn(await build());
      close();
    } catch (ex) {
      mount(err, errorBox(errorText(ex)));
      b.disabled = false;
    }
  };

  const address = textInput({ type: 'email', value: ctx.me.email ?? '', placeholder: 'komu@email.cz', maxLength: 120 });
  const mailBox = el('div', { class: 'stack' }, field('Poslat na adresu', address));
  mailBox.hidden = true;
  const mail = el(
    'button',
    {
      class: 'btn secondary block',
      onClick: async () => {
        clear(err);
        if (mailBox.hidden) {
          mailBox.hidden = false;
          setTimeout(() => address.focus(), 30);
          return;
        }
        if (!address.value.includes('@')) {
          mount(err, errorBox('Zkontroluj e-mailovou adresu.'));
          return;
        }
        mail.disabled = true;
        try {
          const doc = await build();
          const r = await sendList(ctx.token, address.value.trim(), doc);
          close();
          toast(`Odesláno na ${r.to}.`);
        } catch (ex) {
          mount(err, errorBox(errorText(ex)));
          mail.disabled = false;
        }
      },
    },
    'Poslat e-mailem',
  );

  const close = openSheet([
    el('h2', {}, title),
    el('p', { class: 'muted small' }, note),
    el('button', { class: 'btn block', onClick: run(printDoc) }, 'Vytisknout nebo uložit PDF'),
    el('button', { class: 'btn secondary block', onClick: run(downloadDoc) }, 'Stáhnout soubor'),
    mailBox,
    mail,
    err,
    el('div', { class: 'row', style: 'justify-content:flex-end' }, el('button', { class: 'btn ghost', onClick: () => close() }, 'Zpět')),
  ]);
}

// ---------------------------------------------------------------------------
// Já: skupiny, děti, PIN, odhlášení
// ---------------------------------------------------------------------------

async function settingsView(main: HTMLElement, ctx: Ctx): Promise<void> {
  const purchasesCard = el('div', { class: 'card stack' }, el('h3', {}, 'Co ode mě přinese Ježíšek'), spinner('Počítám…'));
  void api
    .myPurchases(ctx.token)
    .then((purchases) => {
      clear(purchasesCard);
      const all = purchases.flatMap((p) => [...p.gifts, ...p.extras]);
      mount(
        purchasesCard,
        el('h3', {}, 'Co ode mě přinese Ježíšek'),
        el('p', { class: 'muted small' }, 'Vidíš jen ty. Nikomu jinému se tvoje nákupy nezobrazují.'),
        all.length === 0
          ? el('p', { class: 'muted' }, 'Zatím nic. Projdi seznamy lidí a zaškrtni, co koupíš.')
          : el(
              'div',
              { class: 'stack', style: 'gap:6px' },
              ...purchases.map((p) =>
                el(
                  'div',
                  { class: 'row between' },
                  p.off_app
                    ? el('span', { class: 'row', style: 'gap:6px' }, el('span', { style: 'font-weight:600' }, p.person_name), el('span', { class: 'pill grey' }, 'není v aplikaci'))
                    : el('a', { href: `#/osoba/${p.person_id}`, style: 'font-weight:600' }, p.person_name),
                  el(
                    'span',
                    { class: 'muted small' },
                    `${p.gifts.length + p.extras.length} ${plural(p.gifts.length + p.extras.length, 'dárek', 'dárky', 'dárků')}`,
                  ),
                ),
              ),
              el('div', { class: 'muted small', style: 'border-top:1px solid var(--line);padding-top:6px' }, tierBreakdown(all)),
            ),
        el('a', { class: 'btn secondary small', href: '#/nakupy', style: 'align-self:flex-start' }, 'Otevřít nákupy'),
      );
    })
    .catch((e) => {
      clear(purchasesCard);
      mount(purchasesCard, el('h3', {}, 'Co ode mě přinese Ježíšek'), errorBox(errorText(e)));
    });

  const joinCode = textInput({ placeholder: 'Kód další skupiny', autocapitalize: 'characters', maxLength: 8 });
  const joinErr = el('div');

  const oldPin = pinInput({ autocomplete: 'current-password' });
  const newPin = pinInput({ autocomplete: 'new-password' });
  const newPin2 = pinInput({ autocomplete: 'new-password' });
  const pinErr = el('div');

  mount(main, 
    el('h2', {}, ctx.me.name),
    accountCard(ctx),
    purchasesCard,
    el(
      'div',
      { class: 'card stack' },
      el('h3', {}, 'Moje skupiny'),
      ...ctx.me.groups.map((g) =>
        el(
          'div',
          { class: 'row between' },
          el('div', {}, el('div', { style: 'font-weight:600' }, g.name), el('div', { class: 'muted small' }, `kód ${g.invite_code}`)),
          el('button', { class: 'btn secondary small', onClick: () => void shareInvite(g.name, g.invite_code) }, 'Pozvat'),
        ),
      ),
      el('a', { class: 'btn secondary block', href: '#/novy' }, '+ Založit další skupinu'),
      el('p', { class: 'muted small' }, 'Další skupina má vlastní pozvánku, třeba pro kolegy nebo kamarády, aniž bys jim dával odkaz na rodinu. Tvůj seznam přání je pořád jeden.'),
      el('hr', { style: 'border:0;border-top:1px solid var(--line);margin:4px 0' }),
      el('p', { class: 'muted small' }, 'Máš pozvánku do další skupiny (třeba od druhé strany rodiny)? Přidej se i tam. Tvoje přání se ukážou v obou.'),
      joinErr,
      el(
        'div',
        { class: 'row' },
        el('div', { class: 'grow' }, joinCode),
        el(
          'button',
          {
            class: 'btn',
            onClick: async () => {
              clear(joinErr);
              try {
                const r = await api.joinGroup(ctx.token, joinCode.value);
                session.selectGroup(r.group_id, joinCode.value);
                toast(r.already ? 'V této skupině už jsi.' : `Vítej ve skupině ${r.name}!`);
                navigate('#/lide');
              } catch (e) {
                joinErr.appendChild(errorBox(errorText(e)));
              }
            },
          },
          'Přidat se',
        ),
      ),
    ),
    el(
      'div',
      { class: 'card stack' },
      el('div', { class: 'section-title' }, el('h3', {}, 'Děti, které spravuji'), el('a', { class: 'btn ghost small', href: '#/dite' }, '+ Přidat')),
      ctx.me.children.length === 0
        ? el('p', { class: 'muted small' }, 'Žádné.')
        : el(
            'div',
            { class: 'stack' },
            ...ctx.me.children.map((c) =>
              el(
                'div',
                { class: 'row between' },
                el(
                  'div',
                  {},
                  el('a', { href: `#/osoba/${c.id}`, style: 'font-weight:600' }, c.name),
                  coGuardianText(c.guardians, ctx.me.id) ? el('div', { class: 'muted small' }, coGuardianText(c.guardians, ctx.me.id)) : null,
                ),
                el(
                  'button',
                  {
                    class: 'btn ghost small',
                    style: 'color:var(--red)',
                    onClick: async () => {
                      const shared = c.guardians.length > 1;
                      const ok = await confirmSheet(
                        shared ? 'Přestat spravovat?' : 'Odebrat dítě?',
                        shared
                          ? `Seznam ti zmizí, ${c.guardians.filter((g) => g.id !== ctx.me.id).map((g) => g.name).join(', ')} ho spravuje dál.`
                          : `Seznam přání „${c.name}“ bude smazaný.`,
                        'Odebrat',
                        true,
                      );
                      if (!ok) return;
                      try {
                        const r = await api.removeChild(ctx.token, c.id);
                        toast(r.deleted ? 'Smazáno.' : 'Odebráno z tvého seznamu.');
                        navigate('#/ja');
                      } catch (e) {
                        toast(errorText(e), true);
                      }
                    },
                  },
                  'Odebrat',
                ),
              ),
            ),
          ),
    ),
    el(
      'form',
      {
        class: 'card stack',
        onSubmit: async (e: Event) => {
          e.preventDefault();
          clear(pinErr);
          if (!/^[0-9]{4,6}$/.test(newPin.value)) return pinErr.appendChild(errorBox('Nový PIN musí mít 4 až 6 číslic.'));
          if (newPin.value !== newPin2.value) return pinErr.appendChild(errorBox('Nové PINy se neshodují.'));
          try {
            await api.changePin(ctx.token, ctx.me.has_pin ? oldPin.value : '', newPin.value);
            toast('PIN změněn.');
            oldPin.value = newPin.value = newPin2.value = '';
          } catch (ex) {
            pinErr.appendChild(errorBox(errorText(ex)));
          }
        },
      },
      el('h3', {}, ctx.me.has_pin ? 'Změna PINu' : 'Nastavit PIN'),
      ctx.me.has_pin
        ? field('Současný PIN', oldPin)
        : el('p', { class: 'muted small' }, 'Zatím se přihlašuješ účtem. S PINem se dostaneš dovnitř i bez e-mailu.'),
      el('div', { class: 'row' }, el('div', { class: 'grow' }, field('Nový PIN', newPin)), el('div', { class: 'grow' }, field('Nový PIN znovu', newPin2))),
      pinErr,
      el('button', { class: 'btn secondary', type: 'submit' }, ctx.me.has_pin ? 'Změnit PIN' : 'Nastavit PIN'),
    ),
    ctx.me.is_admin ? el('a', { class: 'btn secondary block', href: '#/sprava' }, 'Správa aplikace') : null,
    el('button', { class: 'btn danger block', onClick: () => logout(ctx.token) }, 'Odhlásit se'),
  );
}

/** Připojení e-mailu nebo Googlu ke stávajícímu profilu. */
function accountCard(ctx: Ctx): HTMLElement {
  const err = el('div');
  const email = textInput({ type: 'email', placeholder: 'tvuj@email.cz', autocomplete: 'email', maxLength: 120 });
  const password = textInput({ type: 'password', placeholder: 'Heslo (aspoň 6 znaků)', autocomplete: 'new-password', maxLength: 72 });
  const form = el('div', { class: 'stack' }, email, password);
  form.hidden = true;

  const connect = el(
    'button',
    {
      class: 'btn secondary block',
      onClick: async () => {
        clear(err);
        if (form.hidden) {
          form.hidden = false;
          setTimeout(() => email.focus(), 30);
          return;
        }
        if (!email.value.includes('@') || password.value.length < 6) {
          mount(err, errorBox('Zkontroluj e-mail a heslo (aspoň 6 znaků).'));
          return;
        }
        connect.disabled = true;
        pending.set({ kind: 'link' });
        try {
          const { jwt } = await signUp(email.value, password.value);
          if (jwt) {
            await finishLink(jwt);
            return;
          }
          clear(err);
          mount(err, el('div', { class: 'notice' }, `Poslali jsme ti e-mail na ${email.value.trim()}. Odkazem v něm účet připojíš.`));
        } catch (ex) {
          // Když už účet existuje, zkusíme rovnou přihlášení.
          try {
            const jwt = await signIn(email.value, password.value);
            await finishLink(jwt);
            return;
          } catch {
            pending.clear();
            mount(err, errorBox(authErrorText(ex)));
            connect.disabled = false;
          }
        }
      },
    },
    'Připojit e-mail',
  );

  const finishLink = async (jwt: string) => {
    try {
      await api.linkAuth(jwt, ctx.token);
      pending.clear();
      toast('Účet je připojený.');
      navigate('#/ja');
    } catch (ex) {
      pending.clear();
      mount(err, errorBox(errorText(ex)));
      connect.disabled = false;
    }
  };

  if (ctx.me.has_account) {
    return el(
      'div',
      { class: 'card stack' },
      el('h3', {}, 'Přihlašování'),
      el('div', { class: 'row between' }, el('span', {}, ctx.me.email ?? 'Účet připojený'), el('span', { class: 'pill' }, 'účet')),
      ctx.me.has_pin ? el('p', { class: 'muted small' }, 'Přihlásit se můžeš účtem i PINem.') : el('p', { class: 'muted small' }, 'Přihlašuješ se jen účtem.'),
      err,
      el(
        'button',
        {
          class: 'btn ghost small',
          style: 'align-self:flex-start;color:var(--red)',
          onClick: async () => {
            clear(err);
            if (!(await confirmSheet('Odpojit účet?', 'Přihlašovat se pak budeš jen jménem a PINem.', 'Odpojit', true))) return;
            try {
              await api.unlinkAuth(ctx.token);
              toast('Účet odpojen.');
              navigate('#/ja');
            } catch (ex) {
              mount(err, errorBox(errorText(ex)));
            }
          },
        },
        'Odpojit účet',
      ),
    );
  }

  return el(
    'div',
    { class: 'card stack' },
    el('h3', {}, 'Přihlašování'),
    el('p', { class: 'muted small' }, 'Teď se přihlašuješ jménem a PINem. Připoj si e-mail nebo Google a půjde to i bez PINu.'),
    el(
      'button',
      {
        class: 'btn light block',
        style: 'border:1px solid var(--line)',
        onClick: () => {
          pending.set({ kind: 'link' });
          location.href = googleUrl();
        },
      },
      'Připojit Google',
    ),
    form,
    err,
    connect,
  );
}

// ---------------------------------------------------------------------------
// Správa (jen is_admin)
// ---------------------------------------------------------------------------

async function adminView(main: HTMLElement, ctx: Ctx): Promise<void> {
  if (!ctx.me.is_admin) {
    navigate('#/ja');
    return;
  }
  mount(main, el('a', { class: 'btn ghost small', href: '#/ja', style: 'align-self:flex-start' }, '‹ Já'), el('h2', {}, 'Správa'), spinner());
  const body = el('div', { class: 'stack' });
  const load = async () => {
    const groups = await api.adminOverview(ctx.token);
    clear(body);
    if (groups.length === 0) body.appendChild(emptyState('🫙', 'Žádné skupiny.'));
    for (const g of groups) {
      body.appendChild(
        el(
          'div',
          { class: 'card stack' },
          el(
            'div',
            { class: 'row between' },
            el('div', {}, el('h3', {}, g.name), el('div', { class: 'muted small' }, `kód ${g.invite_code} · založeno ${new Date(g.created_at).toLocaleDateString('cs-CZ')}`)),
            el(
              'button',
              {
                class: 'btn danger small',
                onClick: async () => {
                  if (!(await confirmSheet('Smazat skupinu?', `„${g.name}“ i všechna členství zmizí. Lidé a jejich přání zůstanou.`, 'Smazat', true))) return;
                  try {
                    await api.adminDeleteGroup(ctx.token, g.id);
                    toast('Skupina smazána.');
                    await load();
                  } catch (e) {
                    toast(errorText(e), true);
                  }
                },
              },
              'Smazat',
            ),
          ),
          ...g.members.map((m) =>
            el(
              'div',
              { class: 'row between', style: 'border-top:1px solid var(--line);padding-top:8px' },
              el(
                'div',
                {},
                el('div', { class: 'row', style: 'gap:6px' }, el('strong', {}, m.name), m.is_child ? el('span', { class: 'pill grey' }, 'dítě') : null, m.locked ? el('span', { class: 'pill red' }, 'zamčeno') : null),
                el('div', { class: 'muted small' }, `${m.gift_count} přání, ${m.bought_count} koupeno`),
              ),
              el(
                'div',
                { class: 'row', style: 'gap:4px' },
                m.is_child ? null : el('button', { class: 'btn ghost small', onClick: () => resetPinSheet(ctx, m.id, m.name) }, 'Reset PIN'),
                m.id === ctx.me.id
                  ? null
                  : el(
                      'button',
                      {
                        class: 'btn ghost small',
                        style: 'color:var(--red)',
                        onClick: async () => {
                          if (!(await confirmSheet('Smazat člověka?', `${m.name} i jeho přání budou smazány. Koupené dárky se ostatním z nákupů odeberou.`, 'Smazat', true))) return;
                          try {
                            await api.adminRemovePerson(ctx.token, m.id);
                            toast('Smazáno.');
                            await load();
                          } catch (e) {
                            toast(errorText(e), true);
                          }
                        },
                      },
                      'Smazat',
                    ),
              ),
            ),
          ),
        ),
      );
    }
  };
  await load();
  main.querySelector('.spinner')?.remove();
  mount(main, body);
}

function resetPinSheet(ctx: Ctx, personId: string, name: string): void {
  const pin = pinInput({ autocomplete: 'off' });
  const err = el('div');
  const close = openSheet([
    el('h2', {}, `Nový PIN pro ${name}`),
    field('PIN (4 až 6 číslic)', pin),
    err,
    el(
      'div',
      { class: 'row', style: 'justify-content:flex-end' },
      el('button', { class: 'btn secondary', onClick: () => close() }, 'Zpět'),
      el(
        'button',
        {
          class: 'btn',
          onClick: async () => {
            clear(err);
            try {
              await api.adminResetPin(ctx.token, personId, pin.value);
              close();
              toast(`PIN pro ${name} nastaven.`);
            } catch (e) {
              err.appendChild(errorBox(errorText(e)));
            }
          },
        },
        'Nastavit',
      ),
    ),
  ]);
  setTimeout(() => pin.focus(), 50);
}
