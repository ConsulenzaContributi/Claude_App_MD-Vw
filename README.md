# md Vw

`md Vw` e un reader Markdown per macOS pensato per leggere file `.md` con una resa editoriale pulita, non come una preview web generica.

## Funzioni principali

- apertura di file Markdown singoli o intere cartelle
- libreria locale con documenti recenti
- colonna unica di lettura con tipografia editoriale
- outline laterale con navigazione tra sezioni
- ricerca nel testo con highlight e salto tra risultati
- tema carta / inchiostro
- focus mode per leggere senza distrazioni
- preferenze locali di lettura
- integrazione macOS per apertura file associati, menu bar e login item

## Stack

- Electron
- React
- Vite
- TypeScript
- `react-markdown`
- `remark-gfm`

## Sviluppo

```bash
npm install
npm run dev
```

## Verifica

```bash
npm run lint
npm run build
```

## Packaging macOS

```bash
npm run dist
```

Nota: il packaging completo `.app/.dmg` con `electron-builder` puo richiedere un volume APFS e ulteriore rifinitura della configurazione macOS.
