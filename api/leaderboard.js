// Classifica globale di DRUMS PINBALL (Vercel Serverless Function + Upstash Redis via REST)
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const MODES = ['classic','multi','time','moon','rush','rhythm','rain','sprint','wave','wind','chaos','turbo','dark','mirror','surv'];
const AVS = ['🥁','🎸','🎧','🚀','👾','🦄','🔥','👑','🐉','🤖','⚡','🎯'];
const MAX_SCORE = 2000000000;

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
  if (!URL_ || !TOK) return res.status(503).json({ error: 'database non collegato' });
  try {
    if (req.method === 'GET') {
      const mode = String(req.query.mode || 'classic');
      if (!MODES.includes(mode)) return res.status(400).json({ error: 'modalità non valida' });
      const [z] = await redis([['ZREVRANGE', 'lb:' + mode, 0, 49, 'WITHSCORES']]);
      const arr = z.result || [];
      const ids = [], scores = [];
      for (let i = 0; i < arr.length; i += 2) { ids.push(arr[i]); scores.push(Number(arr[i + 1])); }
      let names = [];
      if (ids.length) { const [h] = await redis([['HMGET', 'lbn', ...ids]]); names = h.result || []; }
      return res.status(200).json({ mode, top: ids.map((id, i) => ({ id, name: names[i] || '🥁|???', score: scores[i] })) });
    }
    if (req.method === 'POST') {
      const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const score = Math.floor(Number(b.score));
      const name = String(b.name || '').normalize('NFC').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 14) || 'GIOCATORE';
      const av = AVS.includes(b.av) ? b.av : '🥁';
      if (!/^[a-z0-9]{8,24}$/.test(String(b.pid)) || !MODES.includes(b.mode) || !Number.isFinite(score) || score < 1 || score > MAX_SCORE)
        return res.status(400).json({ error: 'dati non validi' });
      await redis([['ZADD', 'lb:' + b.mode, 'GT', score, b.pid], ['HSET', 'lbn', b.pid, av + '|' + name]]);
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).end();
  } catch (e) {
    return res.status(500).json({ error: 'errore' });
  }
};
