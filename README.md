# Corpus – medicinsk latin

En lille webapp til at øve betydningen af ~690 latinske anatomiske termer. Den virker på telefon og computer, kan lægges på hjemmeskærmen og virker offline.

- **Quiz:** latinsk ord → vælg den engelske betydning blandt 4 (eller omvendt).
- **Forklaringskort:** dansk betydning, kort forklaring, huskeråd og billede, hvor det giver mening.
- **Smart gentagelse:** ord man svarer forkert på, kommer hurtigt igen; ord man kan, kommer sjældnere (Leitner-bokse).
- **Kapitler uden gentagelser:** gennemgå ét bogstav fra listen eller ét emne, hvert ord præcis én gang; appen husker, hvor man slap. Kan vælges som standard under Indstillinger.
- **Fremskridt:** lært / i gang / ikke set, dagens svar og antal dage i træk. Gemmes i browseren på hver enhed.
- **Ordliste:** søg og slå op i alle ord.

Appen er rene statiske filer i `docs/` (ingen build, ingen server, ingen API-kald), hostet med GitHub Pages.

## Indholdet

Indholdet er lavet én gang med Claude API og ligger i `content/`:

```bash
python tools/extract_words.py "Medical Terminology.xlsx" source/words_source.json
python tools/generate_content.py test      # én prøve-forespørgsel, viser pris
python tools/generate_content.py submit    # batch med alle ord
python tools/generate_content.py collect   # hent resultater
python tools/images.py fetch               # billeder fra Wikipedia/Wikimedia Commons
powershell -File tools/compress_images.ps1 # alle billeder -> JPEG, højst 520 px
python tools/images.py check               # Claude godkender/afviser hvert billede
python tools/build_data.py                 # -> docs/data/words.json
python tools/make_icons.py                 # app-ikoner
```

API-nøglen læses fra miljøvariablen `ANTHROPIC_API_KEY` eller fra en `.env`-fil i roden (`ANTHROPIC_API_KEY=...`). `.env` står i `.gitignore` og kommer aldrig i repoet.

Lokal test: `python -m http.server 8791 --directory docs` og åbn http://localhost:8791.

Billeder: Wikimedia Commons; ophavsmand og licens vises under hvert billede i appen.
