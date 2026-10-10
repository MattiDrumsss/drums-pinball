// Account + salvataggio nel cloud di DRUMS PINBALL
// Vercel Serverless Function + Upstash Redis (piano gratuito). Nessuna email richiesta.
const { scrypt, randomBytes, timingSafeEqual } = require('crypto');
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const UOK = /^[A-Za-z0-9_.\-]{3,14}$/;
const MAX_SAVE = 300000; // byte

async function redis(cmds) {
  const r = await fetch(URL_ + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOK, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds)
  });
  if (!r.ok) throw new Error('redis ' + r.status);
  return r.json();
}
const hash = (p, salt) => new Promise((ok, ko) => scrypt(p, salt, 32, (e, k) => (e ? ko(e) : ok(k))));
const ipOf = (req) => String((req.headers['x-forwarded-for'] || 'x').split(',')[0]).trim().slice(0, 45);

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const fail = (c, m, extra) => res.status(c).json(Object.assign({ error: m }, extra || {}));
  if (!URL_ || !TOK) return fail(503, 'Servizio non disponibile');
  if (req.method !== 'POST') return fail(405, 'Metodo non valido');
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const auth = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const who = async () => {
      if (!/^[a-f0-9]{48}$/.test(auth)) return null;
      const [r] = await redis([['GET', 'sess:' + auth]]);
      return r.result || null;
    };

    if (b.a === 'register') {
      const u = String(b.u || ''), p = String(b.p || '');
      if (!UOK.test(u)) return fail(400, 'Il nome deve avere 3-14 caratteri: lettere, numeri, _ . -');
      if (p.length < 6 || p.length > 64) return fail(400, 'La password deve avere almeno 6 caratteri');
      const ip = ipOf(req);
      const [n] = await redis([['INCR', 'rlr:' + ip], ['EXPIRE', 'rlr:' + ip, 3600]]);
      if (n.result > 10) return fail(429, 'Troppi account creati da qui. Riprova più tardi.');
      const ul = u.toLowerCase(), salt = randomBytes(16).toString('hex');
      const h = (await hash(p, salt)).toString('hex');
      const [s] = await redis([['SET', 'acct:' + ul, JSON.stringify({ u, s: salt, h }), 'NX']]);
      if (!s.result) return fail(409, 'Questo nome è già usato, scegline un altro');
      const tok = randomBytes(24).toString('hex');
      await redis([['SET', 'sess:' + tok, ul, 'EX', 7776000]]);
      return res.status(200).json({ tok, u, v: 0 });
    }

    if (b.a === 'login') {
      const u = String(b.u || ''), p = String(b.p || '');
      if (!UOK.test(u) || !p) return fail(401, 'Nome o password errati');
      const ul = u.toLowerCase();
      const [rl] = await redis([['INCR', 'rll:' + ul], ['EXPIRE', 'rll:' + ul, 900]]);
      if (rl.result > 10) return fail(429, 'Troppi tentativi. Riprova tra 15 minuti.');
      const [a] = await redis([['GET', 'acct:' + ul]]);
      if (!a.result) return fail(401, 'Nome o password errati');
      const acc = JSON.parse(a.result);
      const h = await hash(p, acc.s), ok = Buffer.from(acc.h, 'hex');
      if (h.length !== ok.length || !timingSafeEqual(h, ok)) return fail(401, 'Nome o password errati');
      const tok = randomBytes(24).toString('hex');
      const r = await redis([['SET', 'sess:' + tok, ul, 'EX', 7776000], ['GET', 'sv:' + ul], ['DEL', 'rll:' + ul]]);
      return res.status(200).json({ tok, u: acc.u, v: Number(r[1].result || 0) });
    }

    const ul = await who();
    if (!ul) return fail(401, 'Sessione scaduta: accedi di nuovo');

    if (b.a === 'load') {
      const [s] = await redis([['GET', 'save:' + ul], ['EXPIRE', 'sess:' + auth, 7776000]]);
      if (!s.result) return res.status(200).json({ v: 0 });
      const o = JSON.parse(s.result);
      return res.status(200).json({ v: o.v, t: o.t, data: o.data });
    }

    if (b.a === 'save') {
      const raw = JSON.stringify(b.data || null);
      if (!b.data || raw.length > MAX_SAVE) return fail(413, 'Salvataggio troppo grande');
      const [c] = await redis([['GET', 'sv:' + ul]]);
      const cur = Number(c.result || 0);
      if (b.bv !== undefined && Number(b.bv) < cur) return fail(409, 'conflitto', { v: cur });
      const [i] = await redis([['INCR', 'sv:' + ul]]);
      const v = i.result, t = Date.now();
      await redis([['SET', 'save:' + ul, JSON.stringify({ v, t, data: b.data })], ['EXPIRE', 'sess:' + auth, 7776000]]);
      return res.status(200).json({ v, t });
    }

    if (b.a === 'logout') {
      await redis([['DEL', 'sess:' + auth]]);
      return res.status(200).json({ ok: true });
    }
    return fail(400, 'Richiesta non valida');
  } catch (e) {
    return fail(500, 'Errore del server');
  }
};
