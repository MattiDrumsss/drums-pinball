// Calendario eventi di DRUMS PINBALL (copia di quello dentro index.html: se lo cambi di là, cambialo anche qui)
const MESI = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
const EVS = [
  { id: 'hal', n: 'Halloween', i: '🎃', f: [10, 24], t: [11, 1] },
  { id: 'xmas', n: 'Natale', i: '🎄', f: [12, 15], t: [1, 6] },
  { id: 'love', n: 'San Valentino', i: '💘', f: [2, 10], t: [2, 14] },
  { id: 'sum', n: 'Estate', i: '☀️', f: [7, 1], t: [8, 31] }
];
const WKE = [
  { n: 'Weekend Turbo', i: '⚡' }, { n: 'Weekend dei Portali', i: '🌌' }, { n: 'Notte al buio', i: '🔦' },
  { n: 'Maratona Multiball', i: '🌀' }, { n: 'Specchio Magico', i: '🔄' }, { n: 'Tempesta di Vento', i: '💨' },
  { n: 'Sprint dei Campioni', i: '🏃' }, { n: 'Il Ritmo del Mulino', i: '🎵' }
];

// Restituisce l'evento attivo nella data indicata e se oggi è il giorno di inizio (quello in cui si manda la notifica).
function eventFor(y, m, d) {
  const md = m * 100 + d;
  for (const e of EVS) {
    const a = e.f[0] * 100 + e.f[1], b = e.t[0] * 100 + e.t[1];
    if (a <= b ? (md >= a && md <= b) : (md >= a || md <= b))
      return { ev: e, seasonal: true, start: md === a, end: 'fino al ' + e.t[1] + ' ' + MESI[e.t[0] - 1] };
  }
  const dt = new Date(Date.UTC(y, m - 1, d)), w = dt.getUTCDay();
  if (w === 0 || w === 6) {
    const day = Math.floor(dt.getTime() / 864e5);
    const ix = (((Math.floor((day + 3) / 7)) % WKE.length) + WKE.length) % WKE.length;
    return { ev: WKE[ix], seasonal: false, start: w === 6, end: 'fino a domenica sera' };
  }
  return null;
}
module.exports = { eventFor };
