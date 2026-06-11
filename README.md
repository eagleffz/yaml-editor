# Mounted YAML Editor

Eine einfache Webanwendung mit Login zum Bearbeiten und Linten von `.yaml`- und `.yml`-Dateien in einem gemounteten Ordner. Gedacht fuer interne, nicht sicherheitskritische Umgebungen.

## Funktionen

- Dateibaum mit Suche, Anlegen neuer Dateien, Speichern mit Konfliktschutz (mtime-Check)
- YAML-Syntax-Highlighting und Zeilennummern
- Serverseitiges YAML-Linting mit Fehler-/Warnungsmarkierung direkt im Editor
- Einklappbare YAML-Bloecke ueber die Pfeile in der Zeilenleiste (einrueckungsbasiert)
- Cleanup-Button: formatiert das YAML sauber (2 Leerzeichen Einrueckung, Kommentare bleiben erhalten)
- Hell-/Dunkelmodus

### Tastenkuerzel

| Kuerzel | Aktion |
| --- | --- |
| `Strg/Cmd + S` | Speichern |
| `Strg/Cmd + Shift + F` | YAML formatieren (Cleanup) |
| `Tab` | 2 Leerzeichen einruecken |

## Start mit Docker Compose

```bash
docker compose pull
docker compose up -d
```

Danach: `http://localhost:3000`

`docker-compose.yml` verwendet das Image `ghcr.io/eagleffz/yaml-editor:latest`.
Falls das GitHub Container Registry Package privat ist, vorher anmelden:

```bash
docker login ghcr.io
```

Standardwerte aus `docker-compose.yml`:

- Benutzer: `admin`
- Passwort: `change-me`
- Gemounteter Ordner: `./data` im Projekt nach `/data` im Container
- Container-Benutzer: `PUID=1000`, `PGID=1000`

Damit die App Dateien im gemounteten Ordner mit deinem Host-Benutzer schreibt:

```bash
PUID=$(id -u) PGID=$(id -g) docker compose up -d
```

## Konfiguration

Die App wird per Environment-Variablen konfiguriert:

| Variable | Default | Zweck |
| --- | --- | --- |
| `APP_USERNAME` | `admin` | Login-Benutzer |
| `APP_PASSWORD` | `admin` | Login-Passwort |
| `SESSION_SECRET` | `dev-secret-change-me` | Signatur fuer das Session-Cookie |
| `DATA_DIR` | `./data` lokal, `/data` im Dockerfile | Ordner mit YAML-Dateien |
| `MAX_FILE_BYTES` | `1048576` | Maximale Dateigroesse fuer den Editor |
| `PORT` | `3000` | HTTP-Port |
| `PUID` | `1000` | UID, unter der der Prozess im Container laeuft |
| `PGID` | `1000` | GID, unter der der Prozess im Container laeuft |

## Lokal ohne Docker

```bash
npm start
```

Die lokale App liest dann standardmaessig aus `./data`.

## Hinweise

- Der Login ist bewusst simpel gehalten und nicht fuer exponierte oder sicherheitskritische Umgebungen gedacht.
- Dateipfade werden serverseitig auf den gemounteten Ordner begrenzt.
- Symlinks werden beim Auflisten uebersprungen.
- Es werden nur Dateien mit `.yaml` oder `.yml` angezeigt und gespeichert.
- YAML wird beim Bearbeiten serverseitig geprueft; Parser-Fehler und einfache Stilwarnungen erscheinen direkt im Editor.
- Der Cleanup-Button formatiert ueber `/api/format`; ungueltiges YAML wird nicht formatiert, sondern mit Fehlermeldung abgelehnt.
- Eingeklappte Bloecke sind nur ausgeblendet: Speichern, Linting und Statusanzeige arbeiten immer mit dem vollstaendigen Inhalt.

## CI

Unter `.github/workflows/ci.yml` liegt eine GitHub Actions Pipeline. Sie fuehrt `npm ci`, `npm run check`, `npm test`, `docker compose config` und einen Docker-Build aus.

Bei Pushes auf den Default-Branch veroeffentlicht die Pipeline das Container-Image als `ghcr.io/eagleffz/yaml-editor:latest`. Zusaetzlich wird jedes gepushte Image mit `sha-<commit>` getaggt. Pull Requests bauen das Image nur zur Pruefung und pushen nichts nach GHCR.
