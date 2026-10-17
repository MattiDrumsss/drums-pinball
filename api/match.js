// Sfide online di DRUMS PINBALL da 2 a 5 giocatori (Vercel Function + Upstash Redis, tutto gratuito)
// I giocatori mandano il loro punteggio circa ogni secondo e ricevono quello degli altri.
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
const MAXP = 5; // massimo di giocatori in una stanza
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
// giocatori presenti (con 2 giocatori: slot 1 e 2) e giocatori della serie in corso (fissati all'avvio)
const slotsOf = (o) => { const a = []; for (let i = 1; i <= MAXP; i++) if (o['p' + i]) a.push(i); return a; };
const slotOf = (o, pid) => { for (let i = 1; i <= MAXP; i++) if (o['p' + i] === pid) return i; return 0; };
const ACT = (o) => { try { if (o.sl) return JSON.parse(o.sl); } catch (e) {} return slotsOf(o); };
const tieOf = (o) => (ACT(o).length > 2 ? 9 : 3); // con 2 giocatori il pareggio è 3, con più giocatori 9
const mkCode = () => { let s = ''; for (let i = 0; i < 4; i++) s += CH[Math.floor(Math.random() * CH.length)]; return s; };

function snap(o, slot, now) {
  const act = ACT(o), n = act.length;
  const pl = act.map((i) => {
    const u = +o['u' + i] || 0;
    return { i, n: o['n' + i], a: o['a' + i], s: +o['s' + i] || 0, f: +o['f' + i] || 0, c: +o['c' + i] || 0, t: +o['t' + i] || 0, r: +o['r' + i] || 0, g: +o['g' + i] || 0, off: u && now - u > 10000 ? 1 : 0, left: +o['x' + i] || 0 };
  });
  const others = pl.filter((p) => p.i !== slot);
  // avversario principale: con 2 giocatori l'altro; con più giocatori il migliore tra gli altri
  const best = others.slice().sort((x, y) => y.s - x.s || x.i - y.i)[0];
  const op = best ? { n: best.n, a: best.a, s: best.s, f: best.f, off: best.off, left: best.left } : null;
  const mine = pl.find((p) => p.i === slot) || { s: 0, f: 0, c: 0, t: 0, r: 0, g: 0 };
  const idx = act.indexOf(slot), pred = n ? act[(idx - 1 + n) % n] : 0; // nella modalità "costruisci" ognuno gioca la mappa di chi lo precede
  const out = {
    now, code: o.c, slot, st: o.st, kind: o.k, val: +o.v, map: o.m, startAt: +o.sa || 0, endAt: +o.ea || 0, w: +o.w || 0,
    be: +o.be || 0, ready: { me: mine.r, op: others.length && others.every((p) => p.r) ? 1 : 0 },
    omap: (o.st === 'play' || o.st === 'done') && o.k === 'build' ? (o['m' + pred] || '[]') : null,
    me: { n: o['n' + slot], a: o['a' + slot], s: mine.s, f: mine.f },
    op,
    again: { me: mine.g, op: others.length && others.every((p) => p.g || p.left) ? 1 : 0, n: pl.filter((p) => p.g).length, of: n },
    rt: +o.rt || 1, rd: +o.rd || 1, sw: +o.sw || 0,
    hist: (() => { try { return JSON.parse(o.h || '[]'); } catch (e) { return []; } })(),
    cw: { me: mine.c, op: best ? best.c : 0 }, tot: { me: mine.t, op: best ? best.t : 0 },
    nextAt: o.st === 'done' && (+o.rd || 1) < (+o.rt || 1) ? (+o.da || 0) + NEXT_MS : 0,
    en: { earned: Math.floor(mine.s / ENERGY), used: +o['au' + slot] || 0 },
    maxp: +o.maxp || 2, np: n, pl,
    bfor: n ? act[(idx + 1) % n] : 0 // per chi costruisco la mappa
  };
  if (o.m === 'custom') { out.cm = o.cm || '[]'; out.cn = o.cn || ''; }
  return out;
}
// 0 = partita ancora aperta, altrimenti il numero dello slot vincitore (con 2 giocatori il pareggio è 3, con più giocatori 9)
function decide(o, now) {
  if (+o.w) return +o.w;
  if (o.st !== 'play') return 0;
  const act = ACT(o), tie = tieOf(o), v = +o.v, ea = +o.ea;
  const sc = act.map((i) => +o['s' + i] || 0);
  const top = () => { const m = Math.max(...sc), w = []; sc.forEach((x, k) => { if (x === m) w.push(act[k]); }); return w.length === 1 ? w[0] : tie; };
  if (o.k === 'tug') {
    const m = Math.max(...sc), li = sc.indexOf(m), rest = sc.filter((_, k) => k !== li), second = rest.length ? Math.max(...rest) : 0;
    if (m - second >= v) return act[li];
    if (now >= ea) return top();
    return 0;
  }
  if (o.k === 'race') {
    const hit = []; sc.forEach((x, k) => { if (x >= v) hit.push(k); });
    if (hit.length) { hit.sort((p, q) => sc[q] - sc[p] || p - q); return act[hit[0]]; }
    if (now >= ea) return top();
    return 0;
  }
  const all = act.every((i) => +o['f' + i] || +o['x' + i]);
  if (all || now >= ea + 4000) return top();
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
  const f = { w: 0, rd: 1, h: '[]', sw: 0 };
  for (let i = 1; i <= MAXP; i++) Object.assign(f, { ['s' + i]: 0, ['f' + i]: 0, ['g' + i]: 0, ['c' + i]: 0, ['t' + i]: 0, ['ev' + i]: '[]', ['au' + i]: 0, ['ak' + i]: 0 });
  if (kind === 'build') {
    Object.assign(f, { st: 'build', be: now + BUILD_MS, sa: 0, ea: 0 });
    for (let i = 1; i <= MAXP; i++) Object.assign(f, { ['r' + i]: 0, ['m' + i]: '' });
    return f;
  }
  const sa = now + 5000;
  return Object.assign(f, { st: 'play', sa, ea: sa + durOf(kind, val) });
};
// round successivo della stessa serie (le mappe costruite si riusano)
const nextRound = (o, now) => {
  const sa = now + 5000, f = { rd: (+o.rd || 1) + 1, st: 'play', sa, ea: sa + durOf(o.k, +o.v), w: 0 };
  for (let i = 1; i <= MAXP; i++) Object.assign(f, { ['s' + i]: 0, ['f' + i]: 0, ['g' + i]: 0, ['ev' + i]: '[]', ['au' + i]: 0 });
  return f;
};
const toPlay = (o, now) => {
  const sa = now + 5000, f = { st: 'play', sa, ea: sa + (+o.v) * 1000 };
  for (const i of ACT(o)) f['m' + i] = o['m' + i] || '[]';
  return f;
};

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
      const maxp = [2, 3, 4, 5].includes(+b.maxp) ? +b.maxp : 2;
      let map = MAPS.includes(b.map) ? b.map : 'arena', extra = {};
      if (b.map === 'custom') { // mappa personalizzata scelta da chi crea la stanza
        const items = cleanItems(b.items);
        if (!items || items.filter((i) => i[0] === 'b' || i[0] === 't').length < 3) return fail(400, 'Mappa personalizzata non valida');
        map = 'custom'; extra = { cm: JSON.stringify(items), cn: clean(b.mname) };
      }
      const c = await newRoom(Object.assign({ k: kind, v: val, m: map, rt, maxp, rd: 1, c1: 0, c2: 0, t1: 0, t2: 0, h: '[]', sw: 0, p1: pid, n1: name, a1: av, s1: 0, f1: 0, u1: now, st: 'wait', w: 0 }, extra));
      return res.status(200).json({ code: c, slot: 1, now });
    }
    if (a === 'join') {
      if (await limited('j')) return fail(429, 'Troppe richieste, riprova tra poco');
      const o = await getRoom();
      if (!o) return fail(404, 'Stanza non trovata: controlla il codice');
      const mine = slotOf(o, pid);
      if (mine) { await redis([['HSET', rk(code), 'x' + mine, 0, 'u' + mine, now]]); return res.status(200).json({ code, slot: mine, now }); }
      if (o.st !== 'wait') return fail(409, 'La partita è già iniziata');
      for (let i = 2; i <= (+o.maxp || 2); i++) {
        if ((await one(['HSETNX', rk(code), 'p' + i, pid])) === 1) {
          await redis([['HSET', rk(code), 'n' + i, name, 'a' + i, av, 's' + i, 0, 'f' + i, 0, 'u' + i, now]]);
          return res.status(200).json({ code, slot: i, now });
        }
      }
      return fail(409, 'La stanza è già piena');
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
        const c = await newRoom(Object.assign({ k: 'time', v: 90, m: map, p1: op, n1: clean(info.n), a1: AVS.includes(info.a) ? info.a : '🥁', p2: pid, n2: name, a2: av, u1: now, u2: now, x1: 0, x2: 0, rt: 1, maxp: 2, sl: '[1,2]' }, roundFields('time', 90, now)));
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
    const slot = slotOf(o, pid);
    if (!slot) return fail(403, 'Non fai parte di questa stanza');
    const act = ACT(o);

    if (a === 'leave') {
      if (slot === 1 && o.st === 'wait') await one(['DEL', rk(code)]);
      else if (o.st === 'wait') await one(['HDEL', rk(code), 'p' + slot, 'n' + slot, 'a' + slot, 's' + slot, 'f' + slot, 'u' + slot]); // si libera il posto
      else await redis([['HSET', rk(code), 'x' + slot, 1]]);
      return res.status(200).json({ ok: true });
    }
    if (a === 'start') {
      if (slot !== 1) return fail(403, 'Solo chi ha creato la stanza può avviare');
      if (slotsOf(o).length < 2) return fail(409, "Manca l'avversario");
      if ((o.st === 'play' && +o.ea > now) || (o.st === 'build' && +o.be > now)) return res.status(200).json(snap(o, slot, now));
      const f = Object.assign(roundFields(o.k, +o.v, now), { sl: JSON.stringify(slotsOf(o)) });
      await redis([['HSET', rk(code), ...Object.entries(f).flat()], ['EXPIRE', rk(code), 1800]]);
      return res.status(200).json(snap(Object.assign({}, o, f), slot, now));
    }
    if (a === 'map') {
      if (o.k !== 'build' || o.st !== 'build') return fail(409, 'Non è il momento di costruire');
      const items = cleanItems(b.items);
      if (!items || items.filter((i) => i[0] === 'b' || i[0] === 't').length < 3) return fail(400, 'Servono almeno 3 tra bumper e bersagli');
      const upd = { ['m' + slot]: JSON.stringify(items), ['r' + slot]: 1 };
      const n = Object.assign({}, o, upd);
      if (act.every((i) => +n['r' + i])) { const f = toPlay(n, now); Object.assign(upd, f); Object.assign(n, f); }
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
      const evId = (now % 100000) * 10 + Math.floor(Math.random() * 10), f = ['au' + slot, used + 1, 'ak' + slot, now];
      for (const i of act) {
        if (i === slot) continue;
        let q = []; try { q = JSON.parse(o['ev' + i] || '[]'); } catch (e) {}
        q.push({ id: evId, t: type });
        f.push('ev' + i, JSON.stringify(q.slice(-6)));
      }
      await redis([['HSET', rk(code), ...f]]);
      return res.status(200).json(Object.assign(snap(Object.assign({}, o, { ['au' + slot]: used + 1 }), slot, now), { evs: [] }));
    }
    if (a === 'again') {
      const upd = { ['g' + slot]: 1 };
      let n = Object.assign({}, o, upd);
      if (act.every((i) => +n['g' + i] || +n['x' + i]) && (o.st === 'done' || +o.w) && (+o.rd || 1) >= (+o.rt || 1)) { const rf = roundFields(o.k, +o.v, now); for (const i of act) { rf['x' + i] = 0; } Object.assign(n, rf); Object.assign(upd, rf); }
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
        const row = act.map((i) => +n['s' + i] || 0); row.push(w); h.push(row);
        act.forEach((i, k) => { const c = (+n['c' + i] || 0) + (w === i ? 1 : 0), t = (+n['t' + i] || 0) + row[k]; upd['c' + i] = c; upd['t' + i] = t; n['c' + i] = c; n['t' + i] = t; });
        Object.assign(upd, { h: JSON.stringify(h), da: now });
        if ((+n.rd || 1) >= (+n.rt || 1)) { // serie finita: più round vinti, a parità più punti totali
          let bi = act[0];
          for (const i of act) if ((+n['c' + i]) > (+n['c' + bi]) || ((+n['c' + i]) === (+n['c' + bi]) && (+n['t' + i]) > (+n['t' + bi]))) bi = i;
          const tied = act.some((i) => i !== bi && (+n['c' + i]) === (+n['c' + bi]) && (+n['t' + i]) === (+n['t' + bi]));
          upd.sw = tied ? tieOf(n) : bi;
        }
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
