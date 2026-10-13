# DRUMS PINBALL - guida rapida (tutto gratuito)

File: index.html (+ api/match.js per le sfide online), sw.js, manifest.json, 4 icone png, package.json, vercel.json, cartella api (leaderboard, cloud, push, cron, _events).

## A. Pubblicare / aggiornare
1. Scompatta lo zip. Su GitHub apri il repository, Add file > Upload files (o aggiungi /upload/main all'indirizzo).
2. Trascina TUTTI i file (anche la cartella api) > Commit changes. Vercel ripubblica da solo.

## B. Database (classifica, account, notifiche)
Vercel > progetto > Storage > Create Database > Upstash for Redis > piano Free > Connect to Project > Redeploy.

## C. Notifiche (una sola volta)
1. Apri CHIAVI-NOTIFICHE.txt (NON e' nello zip, non caricarlo su GitHub).
2. Vercel > progetto > Settings > Environment Variables: aggiungi VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e CRON_SECRET con i valori del file.
3. Deployments > (...) > Redeploy.
4. Sul telefono: Impostazioni > Notifiche eventi > Attiva. Deve arrivare una notifica di prova.
Su iPhone serve prima l'installazione: Safari > Condividi > Aggiungi alla schermata Home, poi apri l'app da li.

## Come funzionano
Ogni giorno alle 08:00 UTC (circa le 9-10 in Italia, Vercel puo' variare entro l'ora) la funzione api/cron.js controlla se oggi inizia un evento (sabato del weekend o primo giorno di un evento stagionale) e manda la notifica a chi l'ha attivata.
Il calendario eventi e' in index.html e in api/_events.js: se lo cambi in uno, cambialo anche nell'altro.

## Limiti gratuiti
Vercel Hobby (uso personale, non commerciale; 1 cron al giorno), Upstash Free (256 MB, 500.000 comandi/mese), GitHub gratis. Nessuna carta richiesta.

## Sfide online 1 contro 1 (nessun servizio in piu')
Usano lo stesso database Upstash gia' collegato: basta caricare index.html, sw.js e api/match.js e fare il Redeploy.
Prova: apri nome.vercel.app/api/match nel browser: deve comparire {"ok":true,"funzione":"attiva","variabili":{"url":true,"token":true},"database":"ok"}. Nell'app c'e' anche il pulsante "Controlla la connessione" (ONLINE).
I punteggi si aggiornano circa ogni secondo (Vercel gratuito non supporta i WebSocket). Ogni partita usa circa 400 comandi del database: con il piano gratuito (500.000 al mese) sono circa 1.000 partite online al mese.
