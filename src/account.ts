// Přihlašování přes Supabase Auth (e-mail s heslem, Google). Aplikace si
// z účtu vezme jen JWT, vymění ho za svůj token relace a dál pracuje po svém.

const URL_BASE = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_KEY as string;

/**
 * Přihlášení Googlem je připravené, ale vypnuté. Zapne se nastavením
 * VITE_GOOGLE_LOGIN=on a zapnutím poskytovatele v Supabase; do té doby
 * aplikace Google nikde nezmiňuje.
 */
export const googleOffered = (import.meta.env.VITE_GOOGLE_LOGIN as string | undefined) === 'on';

export class AuthError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

interface TokenResponse {
  access_token?: string;
  user?: { id: string; email?: string };
  msg?: string;
  error_description?: string;
  error?: string;
  code?: string;
}

async function call(path: string, body: unknown, jwt?: string): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetch(`${URL_BASE}/auth/v1/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        apikey: KEY,
        'Content-Type': 'application/json',
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new AuthError('network');
  }
  const text = await res.text();
  let data: TokenResponse = {};
  if (text) {
    try {
      data = JSON.parse(text) as TokenResponse;
    } catch {
      data = {};
    }
  }
  if (!res.ok) throw new AuthError(data.error_description || data.msg || data.code || data.error || 'auth_failed');
  return data;
}

/** Přihlášení e-mailem a heslem. Vrací JWT. */
export async function signIn(email: string, password: string): Promise<string> {
  const r = await call('token?grant_type=password', { email: email.trim(), password });
  if (!r.access_token) throw new AuthError('auth_failed');
  return r.access_token;
}

/**
 * Založení účtu. Když je v projektu zapnuté potvrzování e-mailu, token
 * nepřijde a člověk musí nejdřív kliknout na odkaz ve zprávě.
 */
export async function signUp(email: string, password: string): Promise<{ jwt: string | null }> {
  const r = await call(`signup?redirect_to=${encodeURIComponent(redirectTarget())}`, {
    email: email.trim(),
    password,
  });
  return { jwt: r.access_token ?? null };
}

let providersPromise: Promise<{ google: boolean; email: boolean }> | null = null;

/** Co má projekt zapnuté. Ptáme se jednou, odpověď je veřejná. */
export function providers(): Promise<{ google: boolean; email: boolean }> {
  if (!googleOffered) return Promise.resolve({ google: false, email: true });
  providersPromise ??= fetch(`${URL_BASE}/auth/v1/settings`, { headers: { apikey: KEY } })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { external?: Record<string, boolean> } | null) => ({
      google: d?.external?.google === true,
      email: d?.external?.email !== false,
    }))
    .catch(() => ({ google: false, email: true }));
  return providersPromise;
}

/**
 * Prvek zůstane schovaný, dokud se nepotvrdí, že je Google zapnutý. Bez toho
 * by lidé končili na chybové stránce Supabase.
 */
export function onlyWithGoogle<T extends HTMLElement>(node: T): T {
  node.hidden = true;
  void providers().then((p) => {
    if (p.google) node.hidden = false;
  });
  return node;
}

/** Odkaz na Google. Po návratu přijde JWT ve fragmentu adresy. */
export function googleUrl(): string {
  const redirect = encodeURIComponent(redirectTarget());
  return `${URL_BASE}/auth/v1/authorize?provider=google&redirect_to=${redirect}`;
}

export async function sendRecovery(email: string): Promise<void> {
  await call(`recover?redirect_to=${encodeURIComponent(redirectTarget())}`, { email: email.trim() });
}

export async function setPassword(jwt: string, password: string): Promise<void> {
  await call('user', { password }, jwt);
}

export async function signOutAccount(jwt: string): Promise<void> {
  try {
    await call('logout', {}, jwt);
  } catch {
    /* odhlášení účtu je jen úklid, aplikace se řídí svým tokenem */
  }
}

function redirectTarget(): string {
  return `${location.origin}${location.pathname}`;
}

/** JWT z návratu od Googlu nebo z potvrzovacího e-mailu. */
export interface Callback {
  jwt: string;
  type: string | null;
}

export function readCallback(): Callback | { error: string } | null {
  const raw = location.hash.replace(/^#/, '');
  if (!raw.includes('access_token=') && !raw.includes('error=')) return null;
  const params = new URLSearchParams(raw);
  const clear = () => history.replaceState(null, '', `${location.pathname}${location.search}`);
  const error = params.get('error_description') ?? params.get('error');
  if (error) {
    clear();
    return { error };
  }
  const jwt = params.get('access_token');
  clear();
  if (!jwt) return null;
  return { jwt, type: params.get('type') };
}

// Rozdělaná registrace přes přesměrování (Google, potvrzovací e-mail) ------

export interface Pending {
  kind: 'register' | 'create' | 'link';
  code?: string;
  groupName?: string;
  name?: string;
  gifts?: unknown[];
}

const PENDING = 'jezisek.pending';
const JWT = 'jezisek.jwt';
const JWT_EMAIL = 'jezisek.jwtEmail';

export const pending = {
  set(p: Pending): void {
    try {
      localStorage.setItem(PENDING, JSON.stringify(p));
    } catch {
      /* bez uložení projde jen přihlášení bez přesměrování */
    }
  },
  take(): Pending | null {
    try {
      const raw = localStorage.getItem(PENDING);
      localStorage.removeItem(PENDING);
      return raw ? (JSON.parse(raw) as Pending) : null;
    } catch {
      return null;
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(PENDING);
    } catch {
      /* nevadí */
    }
  },
};

/** Účet přihlášený v tomhle okně, který ještě nemá profil v aplikaci. */
export const heldAccount = {
  set(jwt: string, email: string | null): void {
    try {
      sessionStorage.setItem(JWT, jwt);
      if (email) sessionStorage.setItem(JWT_EMAIL, email);
    } catch {
      /* nevadí */
    }
  },
  get(): { jwt: string; email: string | null } | null {
    try {
      const jwt = sessionStorage.getItem(JWT);
      return jwt ? { jwt, email: sessionStorage.getItem(JWT_EMAIL) } : null;
    } catch {
      return null;
    }
  },
  clear(): void {
    try {
      sessionStorage.removeItem(JWT);
      sessionStorage.removeItem(JWT_EMAIL);
    } catch {
      /* nevadí */
    }
  },
};

/** E-mail schovaný v JWT, ať ho nemusíme dotahovat zvlášť. */
export function emailFromJwt(jwt: string): string | null {
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { email?: string };
    return payload.email ?? null;
  } catch {
    return null;
  }
}

export function authErrorText(e: unknown): string {
  const code = e instanceof AuthError ? e.code : '';
  if (code === 'network') return 'Nepodařilo se spojit se serverem. Zkus to znovu.';
  if (/invalid login credentials/i.test(code)) return 'E-mail nebo heslo nesedí.';
  if (/email not confirmed/i.test(code)) return 'Nejdřív potvrď e-mail odkazem, který ti přišel.';
  if (/already registered|already been registered/i.test(code)) return 'Tenhle e-mail už účet má. Přihlas se jím.';
  if (/password/i.test(code) && /least|short|6/i.test(code)) return 'Heslo musí mít aspoň 6 znaků.';
  if (/rate limit|too many/i.test(code)) return 'Příliš mnoho pokusů. Zkus to za chvíli.';
  if (/provider is not enabled|unsupported provider/i.test(code)) return 'Přihlášení Googlem zatím není zapnuté.';
  if (!code) return 'Přihlášení se nepovedlo. Zkus to prosím znovu.';
  return code;
}
