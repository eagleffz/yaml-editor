# Changelog

## v1.1.0 (2026-06-11)

### Neu

- Einklappbare YAML-Bloecke: Pfeile in der Zeilenleiste falten einrueckungsbasierte Bloecke ein und aus; die Zeilennummern zeigen weiterhin die echten Dateizeilen, und Speichern/Linting arbeiten immer mit dem vollstaendigen Inhalt.
- Cleanup-Button und `Strg/Cmd+Shift+F`: formatiert das YAML serverseitig ueber den neuen Endpoint `POST /api/format` (2 Leerzeichen Einrueckung, Kommentare und Mehrfach-Dokumente bleiben erhalten). Ungueltiges YAML wird mit Fehlermeldung abgelehnt.

### Geaendert

- CI baut bei `v*`-Tags zusaetzlich versionierte Container-Images (`x.y.z` und `x.y`).
- `node_modules` aus der Versionskontrolle entfernt, `.gitignore` ergaenzt.

## v1.0.0

- Erste Version: Login, Dateiliste, YAML-Editor mit Syntax-Highlighting, serverseitigem Linting, Darkmode und Docker-Setup.
