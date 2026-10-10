# DRUMS PINBALL - guida rapida (tutto gratuito)

Contenuto: index.html, sw.js, manifest.json, 4 icone png, cartella api (leaderboard.js e cloud.js).

## A. Pubblicare il gioco su Vercel
1. Scompatta lo zip sul computer.
2. Su github.com (account gratuito): "+" > New repository > nome "drums-pinball" > Create repository.
3. Nella pagina del repository: link "uploading an existing file" > trascina TUTTO il contenuto della cartella (anche la cartella api) > Commit changes.
4. Su vercel.com: Log in with GitHub > Add New > Project > Import accanto a "drums-pinball" > Deploy.
5. L'indirizzo (nome.vercel.app) e' quello da dare agli amici.
Per aggiornare in futuro: nel repository GitHub > Add file > Upload files > trascina i file nuovi > Commit. Vercel ripubblica da solo.

## B. Creare il database (serve per classifica e account)
1. Vercel > apri il progetto > scheda Storage.
2. Create Database > Upstash > Upstash for Redis > continua.
3. Nome a piacere, regione Europa (Francoforte), piano FREE (nessuna carta) > Create.
4. Collegalo al progetto (Connect to Project / Connect Store): Vercel aggiunge da solo KV_REST_API_URL e KV_REST_API_TOKEN.
5. Deployments > menu (...) dell'ultimo deploy > Redeploy.
6. Prova: apri nome.vercel.app/api/leaderboard?mode=classic - deve comparire {"mode":"classic","top":[]}.

## C. Installare l'app sul telefono
- Android (Chrome): menu a tre puntini > Installa app.
- iPhone (Safari): Condividi > Aggiungi alla schermata Home.

## Limiti gratuiti
Vercel Hobby: gratis per uso personale e non commerciale. Upstash Free: 256 MB e 500.000 comandi al mese. Nessuna carta richiesta.
