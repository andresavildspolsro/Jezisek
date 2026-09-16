// Odešle seznam e-mailem přes Resend.
//
// Klient pošle token relace, adresu a strukturovaný dokument; HTML se skládá
// až tady a všechno se escapuje, aby přes aplikaci nešlo rozeslat cokoli.
// Databáze navíc hlídá, kolikrát kdo smí poslat.

interface Row {
  title: string;
  tier: 1 | 2 | 3;
  url?: string | null;
  note?: string | null;
  badge?: string | null;
}

interface Section {
  heading: string;
  subheading?: string | null;
  rows: Row[];
}

interface Doc {
  title: string;
  intro: string;
  sections: Section[];
}

const TIER_LABEL: Record<number, string> = {
  1: 'do 1 000 Kč',
  2: '1 000 až 3 000 Kč',
  3: 'nad 3 000 Kč',
};
const TIER_STYLE: Record<number, string> = {
  1: 'background:#e2f2e7;color:#2e7d4f',
  2: 'background:#fbf1dc;color:#8a6416',
  3: 'background:#fbe4e1;color:#b3261e',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM = Deno.env.get('JEZISEK_FROM') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

function safeUrl(u: string): string | null {
  return /^https?:\/\//i.test(u) ? u : null;
}

function render(doc: Doc, fromName: string): string {
  const sections = doc.sections
    .map((s) => {
      const rows =
        s.rows.length === 0
          ? '<p style="color:#6b7a72;font-size:14px;margin:0">Zatím nic.</p>'
          : s.rows
              .map((r) => {
                const url = r.url ? safeUrl(r.url) : null;
                const tier = TIER_LABEL[r.tier] ? r.tier : 1;
                return `<tr><td style="padding:10px 0;border-bottom:1px dashed #e3d9c8">
      <div style="font-weight:600;color:#1f2a24">${esc(r.title)}</div>
      <div style="margin-top:4px">
        <span style="${TIER_STYLE[tier]};font-size:12px;font-weight:700;padding:2px 8px;border-radius:999px">${esc(TIER_LABEL[tier])}</span>
        ${r.badge ? `<span style="background:#ece6da;color:#6b7a72;font-size:12px;font-weight:700;padding:2px 8px;border-radius:999px">${esc(r.badge)}</span>` : ''}
      </div>
      ${r.note ? `<div style="color:#6b7a72;font-size:14px;margin-top:4px">${esc(r.note)}</div>` : ''}
      ${url ? `<div style="font-size:14px;margin-top:4px"><a href="${esc(url)}" style="color:#1b5e46">${esc(url)}</a></div>` : ''}
    </td></tr>`;
              })
              .join('\n');
      return `<h2 style="font-size:18px;color:#0f3d2e;margin:24px 0 4px;border-bottom:1px solid #e3d9c8;padding-bottom:6px">
      ${esc(s.heading)}${s.subheading ? ` <span style="background:#ece6da;color:#6b7a72;font-size:12px;font-weight:700;padding:2px 8px;border-radius:999px">${esc(s.subheading)}</span>` : ''}
    </h2>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">${rows}</table>`;
    })
    .join('\n');

  return `<!doctype html><html lang="cs"><body style="margin:0;padding:24px;background:#f6efe3;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1f2a24">
  <div style="max-width:640px;margin:0 auto;background:#fffcf6;border:1px solid #e3d9c8;border-radius:14px;padding:24px">
    <h1 style="font-size:24px;color:#0f3d2e;margin:0">${esc(doc.title)}</h1>
    <p style="color:#6b7a72;margin:6px 0 0;font-size:15px">${esc(doc.intro)}</p>
    ${sections}
    <p style="color:#6b7a72;font-size:12px;text-align:center;margin-top:24px">Poslal ${esc(fromName)} z aplikace Ježíšek 🎁</p>
  </div>
</body></html>`;
}

function fail(code: string, status = 400): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail('method_not_allowed', 405);
  if (!RESEND_KEY || !FROM) return fail('email_not_configured', 503);

  let body: { token?: string; to?: string; doc?: Doc };
  try {
    body = await req.json();
  } catch {
    return fail('bad_request');
  }
  const { token, to, doc } = body;
  if (!token || !doc || !Array.isArray(doc.sections)) return fail('bad_request');
  if (doc.sections.length > 60) return fail('too_large');

  // Databáze ověří token, adresu i limit a rovnou odeslání zapíše.
  const allow = await fetch(`${SUPABASE_URL}/rest/v1/rpc/register_email_send`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_token: token, p_to: to ?? '' }),
  });
  if (!allow.ok) {
    const text = await allow.text();
    const code = /email_rate_limit|email_invalid|unauthorized/.exec(text)?.[0] ?? 'send_failed';
    return fail(code, code === 'unauthorized' ? 401 : 400);
  }
  const { to: recipient, from_name: fromName } = (await allow.json()) as { to: string; from_name: string };

  const sent = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: [recipient],
      subject: `${doc.title} · Ježíšek`,
      html: render(doc, fromName),
    }),
  });
  if (!sent.ok) {
    console.error('resend', sent.status, await sent.text());
    return fail('send_failed', 502);
  }

  return new Response(JSON.stringify({ sent: true, to: recipient }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
