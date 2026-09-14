// Tenký klient nad Supabase RPC. Žádná knihovna: jen fetch na /rest/v1/rpc.
// Veškerá přístupová pravidla hlídá databáze; tady se jen volají funkce.

const URL = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_KEY as string;

export class ApiError extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}

/** Zavolá databázovou funkci. Chybu vrací jako ApiError s kódem z databáze. */
export async function rpc<T>(fn: string, params: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(params),
    });
  } catch {
    throw new ApiError('network', 0);
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const msg = (data as { message?: unknown } | null)?.message;
    throw new ApiError(typeof msg === 'string' ? msg : 'server', res.status);
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const err = (data as { error?: unknown }).error;
    if (typeof err === 'string') throw new ApiError(err);
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

export type Tier = 1 | 2 | 3;

export interface GiftInput {
  title: string;
  tier: Tier;
  url?: string | null;
  note?: string | null;
}

export interface Gift {
  id: string;
  title: string;
  tier: Tier;
  url: string | null;
  note: string | null;
  created_at: string;
  /** null = jde o můj vlastní seznam, stav se nezobrazuje */
  taken: boolean | null;
  mine: boolean | null;
}

export interface GroupRef {
  id: string;
  name: string;
  invite_code: string;
}

export interface Me {
  id: string;
  name: string;
  is_admin: boolean;
  groups: GroupRef[];
  children: { id: string; name: string }[];
}

export interface GroupPreview {
  id: string;
  name: string;
  invite_code: string;
  members: { id: string; name: string }[];
}

export interface PersonCard {
  id: string;
  name: string;
  is_child: boolean;
  managed_by_me: boolean;
  gift_count: number;
  free_count: number;
}

export interface PersonGifts {
  person: {
    id: string;
    name: string;
    is_child: boolean;
    managed_by_me: boolean;
    is_me: boolean;
  };
  gifts: Gift[];
}

export interface Purchase {
  person_id: string;
  person_name: string;
  gifts: Gift[];
}

export interface AdminGroup {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
  members: {
    id: string;
    name: string;
    is_child: boolean;
    locked: boolean;
    gift_count: number;
    bought_count: number;
  }[];
}

interface SessionResult {
  token: string;
  group_id: string;
  invite_code?: string;
}

// ---------------------------------------------------------------------------
// Volání
// ---------------------------------------------------------------------------

export const api = {
  groupPreview: (code: string) => rpc<GroupPreview | null>('group_preview', { p_code: code }),
  createGroup: (groupName: string, name: string, pin: string, gifts: GiftInput[]) =>
    rpc<SessionResult>('create_group', { p_group_name: groupName, p_name: name, p_pin: pin, p_gifts: gifts }),
  register: (code: string, name: string, pin: string, gifts: GiftInput[]) =>
    rpc<SessionResult>('register', { p_code: code, p_name: name, p_pin: pin, p_gifts: gifts }),
  login: (code: string, name: string, pin: string) =>
    rpc<SessionResult>('login', { p_code: code, p_name: name, p_pin: pin }),
  logout: (token: string) => rpc<null>('logout', { p_token: token }),

  me: (token: string) => rpc<Me>('me', { p_token: token }),
  joinGroup: (token: string, code: string) =>
    rpc<{ group_id: string; name: string; already: boolean }>('join_group', { p_token: token, p_code: code }),
  groupPeople: (token: string, group: string) =>
    rpc<PersonCard[]>('group_people', { p_token: token, p_group: group }),
  personGifts: (token: string, person: string) =>
    rpc<PersonGifts>('person_gifts', { p_token: token, p_person: person }),

  addGift: (token: string, owner: string, g: GiftInput) =>
    rpc<Gift>('add_gift', {
      p_token: token,
      p_owner: owner,
      p_title: g.title,
      p_tier: g.tier,
      p_url: g.url ?? null,
      p_note: g.note ?? null,
    }),
  updateGift: (token: string, gift: string, g: GiftInput) =>
    rpc<Gift>('update_gift', {
      p_token: token,
      p_gift: gift,
      p_title: g.title,
      p_tier: g.tier,
      p_url: g.url ?? null,
      p_note: g.note ?? null,
    }),
  deleteGift: (token: string, gift: string) => rpc<null>('delete_gift', { p_token: token, p_gift: gift }),
  claimGift: (token: string, gift: string) => rpc<Gift>('claim_gift', { p_token: token, p_gift: gift }),
  unclaimGift: (token: string, gift: string) => rpc<Gift>('unclaim_gift', { p_token: token, p_gift: gift }),
  myPurchases: (token: string) => rpc<Purchase[]>('my_purchases', { p_token: token }),

  addChild: (token: string, name: string, gifts: GiftInput[]) =>
    rpc<{ id: string; name: string }>('add_child', { p_token: token, p_name: name, p_gifts: gifts }),
  removeChild: (token: string, child: string) => rpc<null>('remove_child', { p_token: token, p_child: child }),
  changePin: (token: string, oldPin: string, newPin: string) =>
    rpc<null>('change_pin', { p_token: token, p_old: oldPin, p_new: newPin }),

  adminOverview: (token: string) => rpc<AdminGroup[]>('admin_overview', { p_token: token }),
  adminResetPin: (token: string, person: string, pin: string) =>
    rpc<null>('admin_reset_pin', { p_token: token, p_person: person, p_new: pin }),
  adminRemovePerson: (token: string, person: string) =>
    rpc<null>('admin_remove_person', { p_token: token, p_person: person }),
  adminDeleteGroup: (token: string, group: string) =>
    rpc<null>('admin_delete_group', { p_token: token, p_group: group }),
};

/** Lidsky srozumitelná hláška ke kódu chyby z databáze. */
export function errorText(e: unknown): string {
  const code = e instanceof ApiError ? e.code : 'server';
  switch (code) {
    case 'network':
      return 'Nepodařilo se spojit se serverem. Zkontroluj připojení a zkus to znovu.';
    case 'unauthorized':
      return 'Přihlášení vypršelo. Přihlas se prosím znovu.';
    case 'group_not_found':
      return 'Skupina s tímto kódem neexistuje. Zkontroluj odkaz od rodiny.';
    case 'group_name_invalid':
      return 'Zadej název skupiny (nejvýše 60 znaků).';
    case 'name_invalid':
      return 'Zadej jméno (nejvýše 40 znaků).';
    case 'name_taken':
      return 'Toto jméno už ve skupině někdo má. Přidej třeba příjmení nebo přezdívku.';
    case 'pin_invalid':
      return 'PIN musí mít 4 až 6 číslic.';
    case 'gifts_min':
      return 'Zadej prosím alespoň tři dárky.';
    case 'gifts_invalid':
    case 'title_invalid':
      return 'Každý dárek potřebuje název.';
    case 'tier_invalid':
      return 'U každého dárku vyber cenovou hladinu.';
    case 'url_invalid':
      return 'Odkaz je příliš dlouhý.';
    case 'bad_credentials':
      return 'Jméno nebo PIN nesedí.';
    case 'locked':
      return 'Příliš mnoho špatných pokusů. Zkus to znovu za 15 minut.';
    case 'forbidden':
      return 'Na to nemáš oprávnění.';
    case 'not_found':
      return 'Položka už neexistuje. Obnov stránku.';
    case 'gift_purchased':
      return 'Tento dárek už někdo koupil, proto ho nejde smazat.';
    case 'own_gift':
      return 'Svůj vlastní dárek si koupit nemůžeš.';
    case 'already_taken':
      return 'Tento dárek si mezitím vzal někdo jiný.';
    case 'not_yours':
      return 'Tento dárek nemáš označený jako svůj nákup.';
    default:
      return 'Něco se nepovedlo. Zkus to prosím znovu.';
  }
}
