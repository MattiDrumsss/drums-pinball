// Controllo giornaliero (Vercel Cron): se oggi inizia un evento, manda la notifica a chi l'ha attivata
const webpush = require('web-push');
const { eventFor } = require('./_events.js');
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const PUB = process.env.VAPID_PUBLIC_KEY, PRI = process.env.VAPID_PRIVATE_KEY;

async function redis(cmds) {
  const r = await fetch(URL_ + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOK, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds)
  });
  if (!r.ok) throw new Error('redis ' + r.status);
  return r.json();
}
function romeDate() {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(new Date()).forEach(x => { p[x.type] = +x.value; });
  return p;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.CRON_SECRET || req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET)
    return res.status(401).json({ error: 'non autorizzato' });
  if (!URL_ || !TOK || !PUB || !PRI) return res.status(503).json({ error: 'notifiche non configurate' });
  try {
    const t = romeDate();
    const r = eventFor(t.year, t.month, t.day);
    if (!r || !r.start) return res.status(200).json({ inviate: 0, motivo: 'oggi non inizia nessun evento' });
    // evita doppi invii se Vercel ripete la chiamata
    const [lock] = await redis([['SET', 'push:sent:' + t.year + '-' + t.month + '-' + t.day, '1', 'NX', 'EX', 172800]]);
    if (!lock.result) return res.status(200).json({ inviate: 0, motivo: 'già inviato oggi' });
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://' + (req.headers.host || 'example.com'), PUB, PRI);
    const payload = JSON.stringify({
      title: r.seasonal ? r.ev.i + ' Evento ' + r.ev.n + '!' : '🎉 Evento del weekend!',
      body: (r.seasonal ? '' : r.ev.i + ' ' + r.ev.n + ': ') + 'monete x2 e punti x2 ' + r.end + '. Vieni a giocare!',
      tag: 'evento', url: '/'
    });
    const [h] = await redis([['HGETALL', 'push:subs']]);
    const arr = h.result || [], subs = [];
    for (let i = 0; i < arr.length; i += 2) { try { subs.push([arr[i], JSON.parse(arr[i + 1])]); } catch (e) {} }
    let sent = 0; const gone = [];
    for (let i = 0; i < subs.length; i += 25) {
      await Promise.all(subs.slice(i, i + 25).map(async ([id, s]) => {
        try { await webpush.sendNotification(s, payload, { TTL: 43200 }); sent++; }
        catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) gone.push(id); }
      }));
    }
    if (gone.length) await redis([['HDEL', 'push:subs', ...gone]]);
    return res.status(200).json({ inviate: sent, rimossi: gone.length, evento: r.ev.n });
  } catch (e) {
    return res.status(500).json({ error: 'errore' });
  }
};
