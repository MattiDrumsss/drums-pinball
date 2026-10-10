// Iscrizione alle notifiche push di DRUMS PINBALL (Vercel Function + Upstash Redis, tutto gratuito)
const crypto = require('crypto');
const webpush = require('web-push');
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const PUB = process.env.VAPID_PUBLIC_KEY, PRI = process.env.VAPID_PRIVATE_KEY;
// accettiamo solo i servizi push ufficiali dei browser
const OK_HOST = /^https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|[a-z0-9.-]+\.mozilla\.com|[a-z0-9.-]*push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)\//;

async function redis(cmds) {
  const r = await fetch(URL_ + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOK, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds)
  });
  if (!r.ok) throw new Error('redis ' + r.status);
  return r.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const fail = (c, m) => res.status(c).json({ error: m });
  const off = 'Notifiche non ancora configurate sul server';
  if (req.method === 'GET') {
    if (!PUB) return fail(503, off);
    return res.status(200).json({ key: PUB });
  }
  if (req.method !== 'POST') return fail(405, 'Metodo non valido');
  if (!URL_ || !TOK || !PUB || !PRI) return fail(503, off);
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const ip = String((req.headers['x-forwarded-for'] || 'x').split(',')[0]).trim().slice(0, 45);
    const [n] = await redis([['INCR', 'rlp:' + ip], ['EXPIRE', 'rlp:' + ip, 3600]]);
    if (n.result > 30) return fail(429, 'Troppe richieste, riprova più tardi');
    const sub = b.sub || {};
    const ep = String(sub.endpoint || b.endpoint || '');
    if (ep.length > 800 || !OK_HOST.test(ep)) return fail(400, 'Dispositivo non supportato');
    const id = crypto.createHash('sha256').update(ep).digest('hex').slice(0, 32);
    const k = sub.keys || {};
    if (b.a === 'unsub') {
      await redis([['HDEL', 'push:subs', id]]);
      return res.status(200).json({ ok: true });
    }
    if (typeof k.p256dh !== 'string' || typeof k.auth !== 'string' || k.p256dh.length > 200 || k.auth.length > 100)
      return fail(400, 'Iscrizione non valida');
    if (b.a === 'sub') {
      await redis([['HSET', 'push:subs', id, JSON.stringify({ endpoint: ep, keys: { p256dh: k.p256dh, auth: k.auth }, t: Date.now() })]]);
      return res.status(200).json({ ok: true });
    }
    if (b.a === 'test') {
      webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://' + (req.headers.host || 'example.com'), PUB, PRI);
      await webpush.sendNotification({ endpoint: ep, keys: { p256dh: k.p256dh, auth: k.auth } },
        JSON.stringify({ title: '🔔 Notifiche attivate!', body: 'Ti avviseremo quando inizia un evento.', tag: 'test', url: '/' }), { TTL: 600 });
      return res.status(200).json({ ok: true });
    }
    return fail(400, 'Richiesta non valida');
  } catch (e) {
    return fail(500, 'Errore del server');
  }
};
