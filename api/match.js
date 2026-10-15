// Sfide online 1 contro 1 di DRUMS PINBALL (Vercel Function + Upstash Redis, tutto gratuito)
// I giocatori mandano il loro punteggio circa ogni secondo e ricevono quello dell'avversario.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const MAPS = ['arena','diamond','zigzag','mill','portal','volcano','twinmill','pachinko','funnel','orbit','giants'];
const AVS = ['🥁','🎸','🎧','🚀','👾','🦄','🔥','👑','🐉','🤖','⚡','🎯'];
const CH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PID = /^[a-z0-9]{8,24}$/;
const RACE_CAP = 180000; // una Corsa dura al massimo 3 minuti
const BUILD_MS = 110000; // tempo per costruire la mappa dell'avversario
const NEXT_MS = 6000; // pausa tra un round e il successivo
const KINDS = ['time', 'race', 'build', 'sab', 'tug'];
const ATKS = ['fog', 'wind', 'heavy', 'flip']; // attacchi della modalità Sabotaggio
const ENERGY = 1500; // punti per ogni carica di energia
const durOf = (k, v) => (k === 'race' || k === 'tug' ? RACE_CAP : v * 1000);

// Mappa creata da un giocatore: [['b'|'p'|'t', x, y], ['w', x, y, dir], ['r', x1, y1, x2, y2]]
function cleanItems(arr) {
  if (!Array.isArray(arr) || arr.length > 24) return null;
  const out = [];
  for (const it of arr) {
    if (!Array.isArray(it) || typeof it[0] !== 'string') return null;
    const t = it[0];
    if (t === 'r') {
      if (it.length !== 5) return null;
      const v = it.slice(1).map(Number);
      if (v.some((x) => !Number.isFinite(x))) return null;
      if (v[0] < 20 || v[0] > 380 || v[2] < 20 || v[2] > 380 || v[1] < 100 || v[1] > 650 || v[3] < 100 || v[3] > 650) return null;
      out.push(['r', ...v.map(Math.round)]);
    } else if (['b', 'p', 't', 'w'].includes(t)) {
      const x = Number(it[1]), y = Number(it[2]);
      if (!(x >= 20 && x <= 380 && y >= 100 && y <= 650)) return null;
      out.push(t === 'w' ? [t, Math.round(x), Math.round(y), Number(it[3]) === -1 ? -1 : 1] : [t, Math.round(x), Math.round(y)]);
    } else return null;
  }
  return out;
}

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
    be: +o.be || 0, ready: { me: +o['r' + slot] || 0, op: +o['r' + op] || 0 },
    omap: (o.st === 'play' || o.st === 'done') && o.k === 'build' ? (o['m' + op] || '[]') : null,
    me: { n: o['n' + slot], a: o['a' + slot], s: +o['s' + slot] || 0, f: +o['f' + slot] || 0 },
    op: has ? { n: o['n' + op], a: o['a' + op], s: +o['s' + op] || 0, f: +o['f' + op] || 0, off: u && now - u > 10000 ? 1 : 0, left: +o['x' + op] || 0 } : null,
    again: { me: +o['g' + slot] || 0, op: +o['g' + op] || 0 },
    rt: +o.rt || 1, rd: +o.rd || 1, sw: +o.sw || 0,
    hist: (() => { try { return JSON.parse(o.h || '[]'); } catch (e) { return []; } })(),
    cw: { me: +o['c' + slot] || 0, op: +o['c' + op] || 0 }, tot: { me: +o['t' + slot] || 0, op: +o['t' + op] || 0 },
    nextAt: o.st === 'done' && (+o.rd || 1) < (+o.rt || 1) ? (+o.da || 0) + NEXT_MS : 0,
    en: { earned: Math.floor((+o['s' + slot] || 0) / ENERGY), used: +o['au' + slot] || 0 }
  };
}
// 0 = partita ancora aperta, 1/2 = vince quel giocatore, 3 = pareggio
function decide(o, now) {
  if (+o.w) return +o.w;
  if (o.st !== 'play') return 0;
  const s1 = +o.s1 || 0, s2 = +o.s2 || 0, v = +o.v, ea = +o.ea;
  if (o.k === 'tug') {
    const d = s1 - s2;
    if (Math.abs(d) >= v) return d > 0 ? 1 : 2;
    if (now >= ea) return s1 > s2 ? 1 : s2 > s1 ? 2 : 3;
    return 0;
  }
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
  // inizio di una nuova serie di round (azzera anche classifica della serie, attacchi ed energia)
  const base = { s1: 0, s2: 0, f1: 0, f2: 0, w: 0, g1: 0, g2: 0, rd: 1, c1: 0, c2: 0, t1: 0, t2: 0, h: '[]', sw: 0, ev1: '[]', ev2: '[]', au1: 0, au2: 0, ak1: 0, ak2: 0 };
  if (kind === 'build') return Object.assign(base, { st: 'build', be: now + BUILD_MS, sa: 0, ea: 0, r1: 0, r2: 0, m1: '', m2: '' });
  const sa = now + 5000;
  return Object.assign(base, { st: 'play', sa, ea: sa + durOf(kind, val) });
};
// round successivo della stessa serie (le mappe costruite si riusano)
const nextRound = (o, now) => { const sa = now + 5000; return { rd: (+o.rd || 1) + 1, st: 'play', sa, ea: sa + durOf(o.k, +o.v), s1: 0, s2: 0, f1: 0, f2: 0, w: 0, g1: 0, g2: 0, ev1: '[]', ev2: '[]', au1: 0, au2: 0 }; };
const toPlay = (o, now) => { const sa = now + 5000; return { st: 'play', sa, ea: sa + (+o.v) * 1000, m1: o.m1 || '[]', m2: o.m2 || '[]' }; };

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const fail = (c, m) => res.status(c).json({ error: m });
  if (req.method === 'GET') { // pagina di diagnosi: apri /api/match nel browser
    const out = { ok: true, funzione: 'attiva', variabili: { url: !!URL_, token: !!TOK } };
    if (URL_ && TOK) {
      try { const r = await redis([['PING']]); out.database = r[0].result === 'PONG' ? 'ok' : 'risposta inattesa'; }
      catch (e) { out.database = 'errore: ' + String(e.message).slice(0, 80); }
    }
    return res.status(200).json(out);
  }
  if (req.method !== 'POST') return fail(405, 'Metodo non valido');
  if (!URL_ || !TOK) { console.error('match: variabili del database mancanti'); return fail(503, 'Online non disponibile al momento'); }
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const a = b.a, pid = String(b.pid || ''), now = Date.now();
    console.log('match', a);
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
      const kind = KINDS.includes(b.kind) ? b.kind : 'time';
      const val = kind === 'race' ? ([10000, 30000, 60000].includes(+b.val) ? +b.val : 30000) : kind === 'tug' ? ([5000, 10000, 20000].includes(+b.val) ? +b.val : 10000) : ([60, 90, 120].includes(+b.val) ? +b.val : 90);
      const rt = [1, 3, 5, 7].includes(+b.rounds) ? +b.rounds : 1;
      const map = MAPS.includes(b.map) ? b.map : 'arena';
      const c = await newRoom({ k: kind, v: val, m: map, rt, rd: 1, c1: 0, c2: 0, t1: 0, t2: 0, h: '[]', sw: 0, p1: pid, n1: name, a1: av, s1: 0, f1: 0, u1: now, st: 'wait', w: 0 });
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
        const c = await newRoom(Object.assign({ k: 'time', v: 90, m: map, p1: op, n1: clean(info.n), a1: AVS.includes(info.a) ? info.a : '🥁', p2: pid, n2: name, a2: av, u1: now, u2: now, x1: 0, x2: 0, rt: 1 }, roundFields('time', 90, now)));
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
      if ((o.st === 'play' && +o.ea > now) || (o.st === 'build' && +o.be > now)) return res.status(200).json(snap(o, slot, now));
      const f = roundFields(o.k, +o.v, now);
      await redis([['HSET', rk(code), ...Object.entries(f).flat()], ['EXPIRE', rk(code), 1800]]);
      return res.status(200).json(snap(Object.assign({}, o, f), slot, now));
    }
    if (a === 'map') {
      if (o.k !== 'build' || o.st !== 'build') return fail(409, 'Non è il momento di costruire');
      const items = cleanItems(b.items);
      if (!items || items.filter((i) => i[0] === 'b' || i[0] === 't').length < 3) return fail(400, 'Servono almeno 3 tra bumper e bersagli');
      const upd = { ['m' + slot]: JSON.stringify(items), ['r' + slot]: 1 };
      const n = Object.assign({}, o, upd);
      if (+n.r1 && +n.r2) { const f = toPlay(n, now); Object.assign(upd, f); Object.assign(n, f); }
      await redis([['HSET', rk(code), ...Object.entries(upd).flat()]]);
      return res.status(200).json(snap(n, slot, now));
    }
    if (a === 'atk') {
      if (o.k !== 'sab' || o.st !== 'play' || now < +o.sa || now > (+o.ea) + 500) return fail(409, 'Non si può attaccare adesso');
      const type = String(b.type);
      if (!ATKS.includes(type)) return fail(400, 'Attacco non valido');
      const used = +o['au' + slot] || 0;
      if (Math.floor((+o['s' + slot] || 0) / ENERGY) - used < 1) return fail(409, 'Non hai energia: fai più punti!');
      if (now - (+o['ak' + slot] || 0) < 2000) return fail(429, 'Aspetta un attimo');
      let q = []; try { q = JSON.parse(o['ev' + opSlot] || '[]'); } catch (e) {}
      q.push({ id: (now % 100000) * 10 + Math.floor(Math.random() * 10), t: type });
      await redis([['HSET', rk(code), 'ev' + opSlot, JSON.stringify(q.slice(-6)), 'au' + slot, used + 1, 'ak' + slot, now]]);
      return res.status(200).json(Object.assign(snap(Object.assign({}, o, { ['au' + slot]: used + 1 }), slot, now), { evs: [] }));
    }
    if (a === 'again') {
      const upd = { ['g' + slot]: 1 };
      let n = Object.assign({}, o, upd);
      if (+n.g1 && +n.g2 && (o.st === 'done' || +o.w) && (+o.rd || 1) >= (+o.rt || 1)) { Object.assign(n, roundFields(o.k, +o.v, now)); Object.assign(upd, roundFields(o.k, +o.v, now)); }
      await redis([['HSET', rk(code), ...Object.entries(upd).flat()]]);
      return res.status(200).json(snap(n, slot, now));
    }
    if (a === 'upd') {
      const n = Object.assign({}, o), upd = { ['u' + slot]: now };
      if (o.st === 'build' && now >= (+o.be) + 2500) { const f = toPlay(o, now); Object.assign(upd, f); Object.assign(n, f); }
      if (o.st === 'done' && (+o.rd || 1) < (+o.rt || 1) && now >= (+o.da || 0) + NEXT_MS) { const f = nextRound(o, now); Object.assign(upd, f); Object.assign(n, f); }
      let evs = []; try { evs = JSON.parse(o['ev' + slot] || '[]'); } catch (e) {}
      if (evs.length && n.st === 'play') upd['ev' + slot] = '[]'; else evs = [];
      if (n.st === 'play') {
        const prev = +n['s' + slot] || 0, dt = Math.max(0, now - (+o['u' + slot] || now));
        const max = prev + 40000 + 8 * dt; // limite anti-trucchi: crescita massima plausibile
        const inGame = now >= (+n.sa) - 500 && now <= (+n.ea) + 6000;
        const ns = inGame ? Math.min(Math.max(prev, Math.floor(+b.score || 0)), max) : prev;
        upd['s' + slot] = ns;
        if (b.fin && (now >= (+n.ea) - 3000 || (o.k === 'race' && ns >= +o.v))) upd['f' + slot] = 1;
      }
      Object.assign(n, upd);
      const w = decide(n, now);
      if (w && !(+n.w)) {
        upd.w = w; upd.st = 'done'; Object.assign(n, { w, st: 'done' });
        let h = []; try { h = JSON.parse(n.h || '[]'); } catch (e) {}
        h.push([+n.s1 || 0, +n.s2 || 0, w]);
        const c1 = (+n.c1 || 0) + (w === 1 ? 1 : 0), c2 = (+n.c2 || 0) + (w === 2 ? 1 : 0), t1 = (+n.t1 || 0) + (+n.s1 || 0), t2 = (+n.t2 || 0) + (+n.s2 || 0);
        Object.assign(upd, { h: JSON.stringify(h), c1, c2, t1, t2, da: now });
        if ((+n.rd || 1) >= (+n.rt || 1)) upd.sw = c1 > c2 ? 1 : c2 > c1 ? 2 : t1 > t2 ? 1 : t2 > t1 ? 2 : 3;
        Object.assign(n, upd);
      }
      await redis([['HSET', rk(code), ...Object.entries(upd).flat()]]);
      return res.status(200).json(Object.assign(snap(n, slot, now), { evs }));
    }
    return fail(400, 'Richiesta non valida');
  } catch (e) {
    console.error('match errore', e && e.message);
    return fail(500, 'Errore del server');
  }
};
