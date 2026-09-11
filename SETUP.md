# Mosaik — Setup

Eine Web-App (PWA): Du stellst dir dein eigenes Tagebuch aus Bausteinen
zusammen — **Gesicht**, **Körper**, **Mentale Gesundheit** — und hältst
jeden Tag fest, was dir wichtig ist. Du kannst beliebig viele Tagebücher
mit unterschiedlichen Baustein-Kombinationen anlegen (z.B. eins nur für
Gesicht, eins für Körper + Gesicht, eins nur für mentale Gesundheit).

## 🔒 Privatsphäre zuerst

Es gibt **kein Konto, keinen Server, keine Cloud**. Alle Fotos, Texte und
Sprachnachrichten werden ausschließlich lokal auf deinem iPhone gespeichert
(IndexedDB/localStorage im Browser). Nichts verlässt dein Gerät. Das
bedeutet auch: Löschst du die App/den Browser-Speicher, sind die Daten weg —
ein manuelles Backup (z.B. Screenshots wichtiger Fotos) liegt in deiner
eigenen Verantwortung.

## So bekommst du die App aufs iPhone

1. **GitHub Pages aktivieren** (einmalig, geht auch am Handy):
   - Repo → **Settings** → links **Pages**
   - *Source*: **Deploy from a branch**
   - Branch: `claude/modular-diary-app-ios-5s30rw`, Ordner `/ (root)` → **Save**
   - Nach ~1 Min erscheint oben die URL, z.B. `https://<user>.github.io/appapp/`
2. Die URL in **Safari** auf dem iPhone öffnen.
3. Teilen-Symbol (□↑) antippen → **„Zum Home-Bildschirm"** → hinzufügen.
4. Ab jetzt startet Mosaik wie eine echte App vom Home-Bildschirm — inkl.
   Kamera- und Mikrofonzugriff für Fotos und Sprachnachrichten.

## Wie die App funktioniert

- **Tagebuch erstellen**: Name, Farbe und Bausteine wählen (mind. einer).
- **Heute**: Für jeden Baustein deines Tagebuchs kannst du täglich einen
  Eintrag machen:
  - *Gesicht* / *Körper*: Foto aufnehmen oder aus der Galerie wählen.
  - *Mentale Gesundheit*: Text schreiben **oder** eine Sprachnachricht
    aufnehmen.
- **Verlauf**: Rasteransicht der letzten Tage, tippen zeigt/bearbeitet den
  jeweiligen Tag rückwirkend.
- **Streak** 🔥: Zählt aufeinanderfolgende Tage, an denen alle Bausteine
  eines Tagebuchs ausgefüllt wurden.
- Über das ⚙-Symbol im Tagebuch kannst du es umbenennen oder löschen.

## Dateien

| Datei | Zweck |
|-------|-------|
| `index.html` | App-Shell / alle Screens |
| `styles.css` | Styling |
| `app.js` | Logik + lokale Datenhaltung (IndexedDB + localStorage) |
| `manifest.json`, `sw.js` | PWA (Installierbarkeit, Offline-Start) |

## Grenzen des MVP (bewusst einfach gehalten)

- Kein Cloud-Sync zwischen Geräten — bewusst, wegen sensibler Fotos.
- Bausteine eines Tagebuchs lassen sich nach dem Anlegen aktuell nicht mehr
  ändern (nur umbenennen/löschen). Neu anlegen, falls sich das ändern soll.
- Ein Eintrag pro Baustein und Tag (neuer Eintrag ersetzt den alten).
