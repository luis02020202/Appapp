# Tripp — Setup

Eine Web-App (PWA): Freunde sammeln gemeinsam Urlaubs-Clips, am Ende werden sie
automatisch zu einem Recap-Video aneinandergereiht.

## Sofort ausprobieren (Demo-Modus, kein Setup)

Solange `config.js` nicht ausgefüllt ist, läuft die App im **Demo-Modus**:
alles funktioniert lokal auf deinem Gerät (Trip anlegen, Videos aufnehmen, Feed,
Recap abspielen). Clips werden dabei **nur auf diesem Gerät** gespeichert, noch
nicht mit Freunden geteilt.

So bekommst du die App aufs Handy:

1. **GitHub Pages aktivieren** (einmalig, geht auch am Handy):
   - Repo → **Settings** → links **Pages**
   - *Source*: **Deploy from a branch**
   - Branch: `claude/vacation-video-app-concept-Uha27`, Ordner `/ (root)` → **Save**
   - Nach ~1 Min erscheint oben die URL, z.B. `https://<user>.github.io/appapp/`
2. URL auf dem Handy öffnen → „Zum Home-Bildschirm hinzufügen" für App-Feeling.

## Echtes Teilen aktivieren (Supabase, ~10 Min am Rechner)

1. Konto auf https://supabase.com anlegen → **New project** (Region EU wählen).
2. **SQL Editor** → New query → Inhalt von `supabase-setup.sql` einfügen → **Run**.
   (Legt Tabellen, Policies und den `clips`-Storage-Bucket an.)
3. **Project Settings → API** öffnen und zwei Werte kopieren:
   - *Project URL* → `SUPABASE_URL`
   - *Project API keys → anon public* → `SUPABASE_ANON_KEY`
4. Diese zwei Werte in `config.js` eintragen, committen, pushen.
5. Fertig: Freunde öffnen den geteilten Link (oder geben den Trip-Code ein) und
   sehen alle Clips gemeinsam.

> Der `anon`-Key darf öffentlich im Repo stehen — er ist durch die Datenbank-Policies
> geschützt. **Niemals** den `service_role`-Key verwenden.

## Optional: Musik fürs Recap

Lege eine `assets/music.mp3` ab (nur lizenzfreie Musik verwenden). Ist die Datei
vorhanden und der „Musik"-Schalter an, läuft sie als Hintergrund über das Recap.

## Dateien

| Datei | Zweck |
|-------|-------|
| `index.html` | App-Shell / alle Screens |
| `styles.css` | Styling |
| `app.js` | Logik + Backend-Abstraktion (Supabase **oder** lokaler Demo-Modus) |
| `config.js` | Deine Supabase-Zugangsdaten |
| `supabase-setup.sql` | Datenbank-Setup (einmal ausführen) |
| `manifest.json`, `sw.js` | PWA (Installierbarkeit) |
| `concept-prototype.html` | Der ursprüngliche Klick-Prototyp (nur zur Ansicht) |

## Grenzen des MVP (bewusst einfach gehalten)

- Kein echtes „KI-Schneiden": Das Recap reiht Clips chronologisch aneinander,
  mit Titelkarte, Labels und optionaler Musik. Smarte Auswahl/Beat-Sync ist v2.
- Offene Policies (jeder mit Link kann lesen/schreiben) — ok für Freundesgruppe,
  vor öffentlichem Launch absichern.
- Supabase Free-Tier hat begrenzten Speicher/Traffic — kurze Clips empfehlen.
