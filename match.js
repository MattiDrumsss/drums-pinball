// Sfide online 1 contro 1 di DRUMS PINBALL (Vercel Function + Upstash Redis, tutto gratuito)
// I giocatori mandano il loro punteggio circa ogni secondo e ricevono quello dell'avversario.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const MAPS = ['arena','diamond','zigzag','mill','portal','volcano','twinmill','pachinko','funnel','orbit','giants'];
const AVS = ['🥁','🎸','🎧','🚀','👾','🦄','🔥','👑','🐉','🤖','⚡','🎯'];
const CH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PID = /^[a-z0-9]{8,24}$/;
const RACE_CAP = 180000; // una Corsa dura al massimo 3 minuti

async function redis(cmds) {
  const r = await fetch(URL_ + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOK, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds)
  });
  if (!r.ok) throw new Error('redis ' + r.status);
  return r.json();
}
const one = async (c) => (await redis([c]))[0].result;
const toObj = (a) => { const o = {}; for (let i = 0; i < (a || []).length; i += 2) o[a[i]] = a[i + 1]; return o; };
const clean = (n) => String(n || '').normalize('NFC').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 14) || 'GIOCATORE';
const rk = (c) => 'rm:' + c;
const mkCode = () => { let s = ''; for (let i = 0; i < 4; i++) s += CH[Math.floor(Math.random() * CH.length)]; return s; };

function snap(o, slot, now) {
  const op = slot === 1 ? 2 : 1, has = !!o['p' + op], u = +o['u' + op] || 0;
  return {
    now, code: o.c, slot, st: o.st, kind: o.k, val: +o.v, map: o.m, startAt: +o.sa || 0, endAt: +o.ea || 0, w: +o.w || 0,
    me: { n: o['n' + slot], a: o['a' + slot], s: +o['s' + slot] || 0, f: +o['f' + slot] || 0 },
    op: has ? { n: o['n' + op], a: o['a' + op], s: +o['s' + op] || 0, f: +o['f' + op] || 0, off: u && now - u > 10000 ? 1 : 0, left: +o['x' + op] || 0 } : null,
    again: { me: +o['g' + slot] || 0, op: +o['g' + op] || 0 }
  };
}
// 0 = partita ancora aperta, 1/2 = vince quel giocatore, 3 = pareggio
function decide(o, now) {
  if (+o.w) return +o.w;
  if (o.st !== 'play') return 0;
  const s1 = +o.s1 || 0, s2 = +o.s2 || 0, v = +o.v, ea = +o.ea;
  if (o.k === 'race') {
    const a = s1 >= v, b = s2 >= v;
    if (a && b) return s1 >= s2 ? 1 : 2;
    if (a) return 1;
    if (b) return 2;
    if (now >= ea) return s1 > s2 ? 1 : s2 > s1 ? 2 : 3;
    return 0;
  }
  if ((+o.f1 && +o.f2) || now >= ea + 4000) return s1 > s2 ? 1 : s2 > s1 ? 2 : 3;
  return 0;
}
async function newRoom(fields) {
  for (let i = 0; i < 8; i++) {
    const c = mkCode();
    if ((await one(['HSETNX', rk(c), 'c', c])) === 1) {
      const f = [];
      for (const [k, v] of Object.entries(fields)) f.push(k, v);
      await redis([['HSET', rk(c), ...f], ['EXPIRE', rk(c), 1800]]);
      return c;
    }
  }
  throw new Error('codici esauriti');
}
const roundFields = (kind, val, now) => {
  const sa = now + 5000;
  return { st: 'play', sa, ea: sa + (kind === 'race' ? RACE_CAP : val * 1000), s1: 0, s2: 0, f1: 0, f2: 0, w: 0, g1: 0, g2: 0 };
};

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const fail = (c, m) => res.status(c).json({ error: m });
  if (req.method !== 'POST') return fail(405, 'Metodo non valido');
  if (!URL_ || !TOK) return fail(503, 'Online non disponibile al momento');
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const a = b.a, pid = String(b.pid || ''), now = Date.now();
    if (!PID.test(pid)) return fail(400, 'Giocatore non valido');
    const name = clean(b.name), av = AVS.includes(b.av) ? b.av : '🥁';
    const ip = String((req.headers['x-forwarded-for'] || 'x').split(',')[0]).trim().slice(0, 45);
    const limited = async (k) => { const [n] = await redis([['INCR', 'rlm:' + k + ':' + ip], ['EXPIRE', 'rlm:' + k + ':' + ip, 60]]); return n.result > 40; };
    const code = String(b.code || '').toUpperCase();
    const getRoom = async () => {
      if (!/^[A-Z0-9]{4}$/.test(code)) return null;
      const o = toObj(await one(['HGETALL', rk(code)]));
      return o.c ? o : null;
    };

    if (a === 'create') {
      if (await limited('c')) return fail(429, 'Troppe richieste, riprova tra poco');
      const kind = b.kind === 'race' ? 'race' : 'time';
      const val = kind === 'race' ? ([10000, 30000, 60000].includes(+b.val) ? +b.val : 30000) : ([60, 90, 120].includes(+b.val) ? +b.val : 90);
      const map = MAPS.includes(b.map) ? b.map : 'arena';
      const c = await newRoom({ k: kind, v: val, m: map, p1: pid, n1: name, a1: av, s1: 0, f1: 0, u1: now, st: 'wait', w: 0 });
      return res.status(200).json({ code: c, slot: 1, now });
    }
    if (a === 'join') {
      if (await limited('j')) return fail(429, 'Troppe richieste, riprova tra poco');
      const o = await getRoom();
      if (!o) return fail(404, 'Stanza non trovata: controlla il codice');
      if (o.p1 === pid) return res.status(200).json({ code, slot: 1, now });
      if (o.p2 === pid) return res.status(200).json({ code, slot: 2, now });
      if ((await one(['HSETNX', rk(code), 'p2', pid])) !== 1) return fail(409, 'La stanza è già piena');
      await redis([['HSET', rk(code), 'n2', name, 'a2', av, 's2', 0, 'f2', 0, 'u2', now]]);
      return res.status(200).json({ code, slot: 2, now });
    }
    if (a === 'find') {
      const as = await one(['GET', 'mm:as:' + pid]);
      if (as && as !== 'pending') {
        const [c, sl] = as.split(':');
        const r = toObj(await one(['HGETALL', rk(c)]));
        if (r.c && !(+r.w)) return res.status(200).json({ code: c, slot: +sl, now });
        await one(['DEL', 'mm:as:' + pid]); // partita vecchia, già finita
      }
      await redis([['SET', 'mm:hb:' + pid, '1', 'EX', 15], ['SET', 'mm:info:' + pid, JSON.stringify({ n: name, a: av }), 'EX', 60]]);
      let self = false;
      for (let i = 0; i < 6; i++) {
        const op = await one(['LPOP', 'mm:q']);
        if (!op) break;
        if (op === pid) { self = true; continue; }
        const [al, as2] = await redis([['GET', 'mm:hb:' + op], ['GET', 'mm:as:' + op]]);
        if (!al.result || (as2.result && as2.result !== 'pending')) continue;
        if (!(await one(['SET', 'mm:as:' + op, 'pending', 'NX', 'EX', 180]))) continue;
        if (!(await one(['SET', 'mm:as:' + pid, 'pending', 'NX', 'EX', 180]))) { await one(['DEL', 'mm:as:' + op]); break; }
        let info = {}; try { info = JSON.parse(await one(['GET', 'mm:info:' + op]) || '{}'); } catch (e) {}
        const map = MAPS[Math.floor(Math.random() * MAPS.length)];
        const c = await newRoom(Object.assign({ k: 'time', v: 90, m: map, p1: op, n1: clean(info.n), a1: AVS.includes(info.a) ? info.a : '🥁', p2: pid, n2: name, a2: av, u1: now, u2: now, x1: 0, x2: 0 }, roundFields('time', 90, now)));
        await redis([['SET', 'mm:as:' + op, c + ':1', 'EX', 180], ['SET', 'mm:as:' + pid, c + ':2', 'EX', 180]]);
        return res.status(200).json({ code: c, slot: 2, now });
      }
      // resto in coda con una sola voce (se l'avevo tolta io o se è passato un po' di tempo la rimetto)
      if (self || (await one(['SET', 'mm:qd:' + pid, '1', 'NX', 'EX', 6]))) await one(['RPUSH', 'mm:q', pid]);
      return res.status(200).json({ waiting: true, now });
    }

    // da qui in poi serve una stanza di cui si fa parte
    const o = await getRoom();
    if (!o) return fail(404, 'Stanza non trovata');
    const slot = o.p1 === pid ? 1 : o.p2 === pid ? 2 : 0;
    if (!slot) return fail(403, 'Non fai parte di questa stanza');
    const opSlot = slot === 1 ? 2 : 1;

    if (a === 'leave') {
      if (slot === 1 && o.st === 'wait') await one(['DEL', rk(code)]);
      else await redis([['HSET', rk(code), 'x' + slot, 1]]);
      return res.status(200).json({ ok: true });
    }
    if (a === 'start') {
      if (slot !== 1) return fail(403, 'Solo chi ha creato la stanza può avviare');
      if (!o.p2) return fail(409, "Manca l'avversario");
      if (o.st === 'play' && +o.ea > now) return res.status(200).json(snap(o, slot, now));
      const f = roundFields(o.k, +o.v, now);
      await redis([['HSET', rk(code), ...Object.entries(f).flat()], ['EXPIRE', rk(code), 1800]]);
      return res.status(200).json(snap(Object.assign({}, o, f), slot, now));
    }
    if (a === 'again') {
      const upd = { ['g' + slot]: 1 };
      let n = Object.assign({}, o, upd);
      if (+n.g1 && +n.g2 && (o.st === 'done' || +o.w)) { Object.assign(n, roundFields(o.k, +o.v, now)); Object.assign(upd, roundFields(o.k, +o.v, now)); }
      await redis([['HSET', rk(code), ...Object.entries(upd).flat()]]);
      return res.status(200).json(snap(n, slot, now));
    }
    if (a === 'upd') {
      const n = Object.assign({}, o), upd = { ['u' + slot]: now };
      if (o.st === 'play') {
        const prev = +o['s' + slot] || 0, dt = Math.max(0, now - (+o['u' + slot] || now));
        const max = prev + 40000 + 8 * dt; // limite anti-trucchi: crescita massima plausibile
        const inGame = now >= (+o.sa) - 500 && now <= (+o.ea) + 6000;
        const ns = inGame ? Math.min(Math.max(prev, Math.floor(+b.score || 0)), max) : prev;
        upd['s' + slot] = ns;
        if (b.fin && (now >= (+o.ea) - 3000 || (o.k === 'race' && ns >= +o.v))) upd['f' + slot] = 1;
      }
      Object.assign(n, upd);
      const w = decide(n, now);
      if (w && !(+o.w)) { upd.w = w; upd.st = 'done'; Object.assign(n, { w, st: 'done' }); }
      await redis([['HSET', rk(code), ...Object.entries(upd).flat()]]);
      return res.status(200).json(snap(n, slot, now));
    }
    return fail(400, 'Richiesta non valida');
  } catch (e) {
    return fail(500, 'Errore del server');
  }
};
