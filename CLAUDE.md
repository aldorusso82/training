# TRAIN.ALDO — istruzioni di progetto per Claude Code

## Chi e cosa
- Utente: Aldo, allenatore e giocatore di padel, scrive in italiano. Risposte concise e dirette, niente giri di parole.
- Progetto: web app personale di allenamento "TRAIN.ALDO", da installare su iPhone e iPad come PWA ("Aggiungi alla schermata Home" da Safari).
- Hosting: GitHub Pages, repository `aldorusso82/training`, branch `main`, cartella root.
  URL finale: https://aldorusso82.github.io/training/
- Aldo non è uno sviluppatore: quando serve una sua azione (login, impostazioni GitHub), spiegala passo per passo con i nomi esatti dei pulsanti.

## Requisito n.1 — immagini REALI
- Ogni esercizio deve mostrare foto reali o frame video di una persona che esegue il movimento. MAI icone, disegni, SVG stilizzati o illustrazioni: servono per riconoscere il movimento a colpo d'occhio.
- Fonte principale: free-exercise-db (https://github.com/yuhonas/free-exercise-db). Contiene ~870 esercizi con 2 foto ciascuno (0.jpg = inizio, 1.jpg = fine).
  - Elenco: https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json
  - Foto: https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/<Nome_Cartella>/0.jpg e /1.jpg
  - SCARICA le foto nella cartella `img/` del repo (niente hotlink): così l'app funziona anche offline.
  - Verifica la licenza nel repo originale e metti un credito nel footer dell'app.
- Corrispondenze già verificate (nome cartella nel database):
  Goblet_Squat · Chin-Up · Dumbbell_Rear_Lunge · Inverted_Row · Inverted_Row_with_Straps · One-Arm_Dumbbell_Row · One_Arm_Lat_Pulldown · Reverse_Flyes · Front_Box_Jump · Alternate_Hammer_Curl · Barbell_Deadlift · Dumbbell_Bench_Press · Barbell_Hip_Thrust · Single_Leg_Glute_Bridge · Plank · Barbell_Curl · Lying_Triceps_Press · Suspended_Push-Up · Suspended_Fallout
- Da cercare in exercises.json: step up, single leg RDL, incline dumbbell press, dumbbell flyes, dumbbell shoulder press, lateral raise, front raise, overhead triceps extension, TRX/suspension varianti.
- Esercizi NON presenti (es. Cossack squat, leg extension iso, plank shoulder tap, push up to toe tap): usa un video YouTube incorporato (dominio youtube-nocookie.com).
  - Non inventare MAI un ID video. Cerca il tutorial, verifica che il video esista e che consenta l'incorporamento, poi inseriscilo.
  - In alternativa prevedi uno spazio "foto tua": Aldo può fotografarsi in palestra e mettere il file in `img/`.
- Mostra sempre le foto grandi (larghezza piena), con le due posizioni inizio/fine affiancate o alternabili con un tocco.

## Programma attuale (base)
Se Aldo incolla una scheda aggiornata, quella ha la priorità e sostituisce questa.
Tieni il programma in `data/program.json`, separato dal codice, così si aggiorna senza toccare l'interfaccia.
- Più schede periodiche in `plans[]` (id, name libero, months = mesi in cui si apre da sola, days). Menu "Scheda" in alto per consultarle.
- Un giorno identico a un'altra scheda si scrive `{"id":"d2","tab":"Day 2","same":{"plan":"lug-set","day":"d2"}}`.
- Senza `rest` nel blocco l'app mostra i pulsanti di recupero 1'/75''/90''/2'. `note` su un esercizio = testo mostrato accanto alle reps; `name` su un esercizio = nome diverso per quella scheda.
- Schede attuali: Luglio–Settembre (sotto), Ottobre, Novembre (vedi program.json).
- `cooldowns` in program.json = 4 sequenze di defaticamento yoga (≥10', foto reali, timer guidato) aggiunte in fondo a OGNI giorno. Ruotano ogni 2 settimane da `rotation.start` (lunedì 21/9/2026): A Completa → B Anche → C Schiena e spalle → D Post-corsa. Motivo: stessa sequenza 2–3 settimane per imparare le posizioni e misurare i progressi.
- `yoga` in program.json = tab "Yoga" sempre visibile: 4 video Flexibility + 4 Forza (intermedio, ~30'). Ogni lunedì cambia il "video della settimana", alternando Flexibility e Forza. Aldo può anche scegliere su Nike Training Club.
- Day 4 di Ottobre/Novembre: varianti Padel/Running · HIIT TRX (casa) · Conditioning (palestra). Sezione `hiit` = work/rest/rounds/roundRest con timer guidato.

Day 1 — Legs + Pull
- Mobilità 5': Leg extension iso monolaterale 20'' ×3 · Elbow plank shoulder tap 8+8
- A ×4 (rec 90''): A1 Goblet squat 8 · A2 Chin up 5
- B ×4 (rec 90''): B1 DB back lunge 5/5 · B2 Australian pull up max
- C ×3 (rec 75''): C1 Cossack squat 6/6 · C2 DB row 6/6
- D ×4 (rec 75''): D1 Single arm lat machine 6 · D2 Reverse fly 6

Day 2 — Metabolic + Cardio
- Mobilità 5': Jump rope 10-20-30-40-50-40-30-20-10
- A ×3 (rec 2'): A1 Step up 6/6 · A2 Run 1000 m
- B ×3 (rec 90''): B1 Box jump 6 · B2 Run 500 m
- C ×3 (rec 60''): C1 Triceps extension 8 · C2 Hammer curl 8

Day 3 — Legs + Push (variante PALESTRA)
- Mobilità 5': Bridge iso mono 20'' ×3 · Push up to toe tap 8 ×3
- A ×4 (rec 2'): A1 Deadlift 6 · A2 DB bench press 6
- B ×4 (rec 90''): B1 SL RDL 6/6 · B2 DB incline bench 6/6
- C ×3 (rec 75''): C1 SL hip thrust (panca) 6/6 · C2 Chest fly 5
- D ×3 (rec 60''): D1 DB military press 6/6 · D2 Alzate laterali 6

Day 3 — variante TRX (selezionabile con un interruttore Palestra/TRX)
- Mobilità: Bridge iso mono 20'' ×3 · TRX fallout 8 ×3
- A ×4: A1 TRX squat to row 6 · A2 TRX push up (piedi nel TRX) 6
- B ×4: B1 TRX single leg squat 6/6 · B2 TRX incline push up (mani nel TRX) 6
- C ×3: C1 TRX hip press monolaterale 6/6 · C2 TRX chest fly 5
- D ×3: D1 TRX Y raise 8 · D2 TRX T fly 8
- Nota progressione da mostrare nell'app: aumentare il carico con angolo del corpo → tempo sotto tensione (3'' discesa) → lavoro monolaterale.
- Blazepod: finisher opzionale dopo il blocco D.

Day 4 — Intervals + Arms
- Running interval 30': 1:1 · 2:2 · 3:3 · 3:3 · 2:2 · 1:1 (min corsa : min recupero), passo corsa ~5'20"–5'30"/km
- A ×4 (rec 75''): A1 Front raises 8 · A2 Barbell curl 8 · A3 French press 8
- Alternativa Day 4: tennis, running o padel 60'

## Atleti (link personali)
- Aldo = link base (https://aldorusso82.github.io/training/), dati in data/program.json.
- Altri atleti: file data/athletes/<id>.json con {name, plans[]} (stessa struttura dei plans; esercizi, yoga e defaticamento arrivano da program.json). Link: …/training/?atleta=<id>. L'atleta resta ricordato sul dispositivo; ?atleta=aldo torna ad Aldo.
- Diario e kg di ogni atleta sono separati in localStorage (prefisso trainaldo.@<id>.). Il manifest NON ha start_url, così l'icona sulla Home mantiene il link personale.
- Atleti: test (scheda dimostrativa), viviana (programma 6–7 settimane dal suo PDF). Elenco in data/athletes/index.json (serve al selettore atleta).
- Un file atleta può avere `exercises` propri (chiavi con prefisso, es. v_), `yoga:false`, `cooldown:false`, e nel piano `note` (regole mostrate in ogni giorno).
- Selettore atleta nel menu Scheda: visibile solo sul dispositivo di Aldo (flag localStorage trainaldo-coach, impostato aprendo ?atleta=aldo o senza parametro).
- Tipi di sezione in più: esercizio a tempo (`time` sull'item → pulsante ▶ timer di lavoro), `rest: 0` = senza recupero, `emom` (minutes + items; `editable` = reps modificabili), `run` (minutes, pace, note), `timer` (durata impostabile), giorno `optional`.

## Funzioni
- Tab per i 4 giorni; per ogni blocco: lettera, tipo (superset/circuito/triset), serie, recupero.
- Riga esercizio: nome, reps, attrezzo, kg; tocco = si apre la scheda con le foto (e il video se presente).
- Kg modificabili per esercizio, salvati in localStorage (ogni dispositivo ha i suoi dati).
- Timer di recupero: pulsante grande "Avvia" nella striscia del recupero, overlay a schermo intero con anello di countdown, colore arancio negli ultimi 10'', verde a fine; vibrazione/suono a fine se il dispositivo lo permette.
- Day 4: griglia visiva degli intervalli, meglio se con timer guidato corsa/recupero.

- Giorni: l'app apre il "prossimo" giorno (quello dopo l'ultimo Allenamento registrato con planId/dayId). Padel, Corsa, Stop non fanno avanzare. Ordine dei giorni modificabile nel menu Scheda (localStorage order.<planId>).
- Promemoria (in app, nessun server): se non ci si allena da ≥2 giorni compare un avviso con frase motivazionale (program.json → motivation). "Programma" salva il prossimo allenamento e scarica un evento .ics con avviso 30' prima, così la notifica arriva dal Calendario dell'iPhone. Notifiche push vere richiedono un server (possibile con Cloudflare Workers).
- Diario: tipi Allenamento, Padel, Corsa, Yoga (contano come allenamento), Fisioterapia, Nota, Stop (motivo + "fino al"). Durante uno stop niente avvisi.
- Pagina del giorno: "⇄ Inverti con…" scambia due giorni (stesso ordine del menu Scheda); "✓ Fatto …" se registrato questa settimana, ✓ anche sul tab.
- Inizio della settimana scelto dall'atleta nel menu Scheda (localStorage weekStart, 0=dom … 6=sab, default lunedì): vale per il conteggio settimane e le statistiche settimanali.
- Settimana della scheda: schede mensili = blocchi di 4 settimane lun–dom dal primo lunedì del mese (i giorni prima contano come sett. 1; poi si ricomincia da 1). Programmi a durata (plan.weeks, es. Viviana 7) = settimane dal primo allenamento.
- Il ✓ "fatto" (nero) vale per il GIRO in corso (si azzera quando tutti i giorni sono fatti o si ripete un giorno), non per la settimana di calendario. ✓ e "prossimo" riconoscono anche le registrazioni senza dayId dal testo («Ottobre · Day 1»). Il prossimo salta i giorni già fatti in settimana.
- Registra: minuti e kcal (Apple Watch) + pulsante "Incolla" che legge un testo tipo «45 min 420 kcal». Una web app non può leggere Apple Salute direttamente.
- Programma: promemoria ripetibili ogni settimana (RRULE nel .ics). Notifiche push vere = server (Cloudflare Worker + Web Push), non ancora fatto.

- Timer recupero: campanello a 15'' dalla fine; a tutto schermo o ridotto a banner in basso (preferenza nel menu Scheda).
- 📝 Nota per il coach su ogni esercizio (exnote.<ex>) + «💬 Invia sensazioni al coach» = messaggio WhatsApp precompilato (wa.me senza numero). Playlist preferite (Forza/Cardio/Yoga): icona verde 🎵 accanto a «Inverti con…» in ogni giorno (anche Yoga) → scelta playlist e impostazione link; link anche nel menu Scheda.
- ⏱ Timer libero (icona accanto a 🎵): Tabata 20/10×8, EMOM, intervalli personalizzati (lavoro/recupero/giri) con il timer guidato. Nel foglio 🎵 «Ascolta qui» = lettore Spotify/YouTube incorporato (limiti: si ferma a schermo bloccato, Spotify senza login = anteprime 30'').

- Musica: solo link esterni (▶ apre Spotify ecc.), niente player incorporato (tolto il 05/10). Item con `alts:[exKey,…]` = selettore variante nella riga (scelta in localStorage alt.<plan>/<day>.<code>); `short` = etichetta del chip. Day 2: tricipiti manubri/TRX/push up gomiti stretti TRX.
- program.json → weekMotivation {1..5}: messaggio mostrato dopo «Registra allenamento» in base agli allenamenti della settimana.

## Design
- Colori: granata #8b1a1a (primario), bianco/avorio come sfondo, testo quasi nero. Niente temi scuri.
- Leggibilità iPhone (versione compatta chiesta il 02/10): testo base 16px, nomi esercizi 16px bold, aree toccabili almeno 44px, contrasto alto.
- Rispetta le safe area di iPhone (notch e barra home).

## PWA
- manifest.json (nome TRAIN.ALDO, display standalone, colori granata/bianco), icone incluse apple-touch-icon 180×180.
- Meta tag per iOS: apple-mobile-web-app-capable, status bar, viewport-fit=cover.
- Service worker con cache di pagina, dati e immagini per l'uso offline in palestra.
- A OGNI rilascio incrementa la versione della cache in sw.js, altrimenti l'iPhone continua a mostrare la versione vecchia.

## Struttura
index.html · styles.css · app.js · data/program.json · img/ · icons/ · manifest.json · sw.js

## Flusso di lavoro
- Dopo ogni modifica: prova l'app, poi commit con messaggio chiaro in italiano e push su `main`.
- Verifica che GitHub Pages sia attivo (Settings → Pages → Deploy from a branch → main, /root). Se non lo è, guida Aldo passo per passo.
- A fine lavoro scrivi ad Aldo in 2–3 righe cosa è cambiato e ricordagli di chiudere e riaprire l'app sul telefono.
