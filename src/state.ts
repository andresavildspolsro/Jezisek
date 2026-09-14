// Stav přihlášení v prohlížeči: token relace, vybraná skupina a poslední kód
// pozvánky (aby se šlo přihlásit i z hlavní stránky bez odkazu).

const KEY_TOKEN = 'jezisek.token';
const KEY_GROUP = 'jezisek.group';
const KEY_CODE = 'jezisek.code';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* soukromý režim apod.: aplikace funguje i bez uložení */
  }
}

export const session = {
  get token(): string | null {
    return read(KEY_TOKEN);
  },
  get groupId(): string | null {
    return read(KEY_GROUP);
  },
  get lastCode(): string | null {
    return read(KEY_CODE);
  },
  start(token: string, groupId: string, code?: string | null): void {
    write(KEY_TOKEN, token);
    write(KEY_GROUP, groupId);
    if (code) write(KEY_CODE, code.toUpperCase());
  },
  selectGroup(groupId: string, code?: string | null): void {
    write(KEY_GROUP, groupId);
    if (code) write(KEY_CODE, code.toUpperCase());
  },
  end(): void {
    write(KEY_TOKEN, null);
    write(KEY_GROUP, null);
  },
};
