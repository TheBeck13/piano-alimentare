# Piano alimentare

PWA statica per consultare il piano alimentare (PDF Progeo Medical) dal telefono.
Il PDF viene letto nel browser con pdf.js; piano e scelte restano solo sul dispositivo (localStorage).

## Uso
1. Apri il sito e tocca **Carica il PDF**.
2. Su iPhone: Condividi → *Aggiungi alla schermata Home* (fallo **prima** di caricare il PDF: l'app installata ha una memoria separata da Safari ed è esente dalla pulizia automatica dei dati).
3. Ogni dispositivo carica il PDF una volta; per un nuovo piano: Info → *Carica un nuovo piano*.

## Sviluppo
```sh
npm install          # solo per la verifica del parser
npm run check        # verifica il parser su PianoAlimentare-5.pdf (non versionato)
npm run serve        # http://localhost:8080
```
- `js/parser.js` è l'unico file legato al formato del PDF.
- Dopo una modifica ai file aggiorna `VERSION` in `sw.js`, così i telefoni scaricano la nuova versione.

## Deploy
GitHub Pages dalla root del branch `main`. Il PDF è escluso da `.gitignore`.
