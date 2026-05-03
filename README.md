# Mounted YAML Editor

Eine einfache Webanwendung mit Login zum Bearbeiten und Linten von `.yaml`- und `.yml`-Dateien in einem gemounteten Ordner. Gedacht fuer interne, nicht sicherheitskritische Umgebungen.

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

## CI

Unter `.github/workflows/ci.yml` liegt eine GitHub Actions Pipeline. Sie fuehrt `npm ci`, `npm run check`, `npm test`, `docker compose config` und einen Docker-Build aus.

Bei Pushes auf den Default-Branch veroeffentlicht die Pipeline das Container-Image als `ghcr.io/eagleffz/yaml-editor:latest`. Zusaetzlich wird jedes gepushte Image mit `sha-<commit>` getaggt. Pull Requests bauen das Image nur zur Pruefung und pushen nichts nach GHCR.
