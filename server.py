#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Révisions Collèges — serveur local.

Sert l'interface (src/) et expose une petite API JSON pour lire/écrire
le fichier de données `donnees.json`.

Principe clé (mise à jour du code sans perte de données) :
  - Le CODE (interface + ce serveur) est embarqué dans l'exécutable.
  - Les DONNÉES vivent dans `donnees.json`, À CÔTÉ de l'exécutable, jamais
    dedans. Remplacer l'exe par une nouvelle version ne touche pas aux données.

Aucune dépendance externe : uniquement la bibliothèque standard Python.
"""

import json
import os
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = 8765          # port par défaut ; on cherche le suivant si occupé
DATA_NAME = "donnees.json"

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}


def _frozen():
    return getattr(sys, "frozen", False)


def data_dir():
    """
    Dossier où vit donnees.json. Choisi pour SURVIVRE au remplacement du code :
      - dev (non gelé)  : le dossier du script (donnees.json visible dans le projet).
      - Windows (exe)   : à côté de l'exécutable (.exe isolé → remplacer l'exe garde
                          donnees.json intact juste à côté).
      - macOS (.app)    : ~/Library/Application Support/RevisionsColleges — HORS du
                          bundle .app, sinon remplacer l'app effacerait les données.
      - Linux           : ~/.local/share/RevisionsColleges.
    """
    if not _frozen():
        return os.path.dirname(os.path.abspath(__file__))
    if sys.platform.startswith("win"):
        return os.path.dirname(sys.executable)
    if sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support/RevisionsColleges")
    else:
        base = os.path.expanduser("~/.local/share/RevisionsColleges")
    os.makedirs(base, exist_ok=True)
    return base


def static_dir():
    """Dossier des fichiers d'interface : embarqués dans l'exe, sinon ./src."""
    if _frozen():
        return os.path.join(sys._MEIPASS, "src")  # type: ignore[attr-defined]
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "src")


DATA_FILE = os.path.join(data_dir(), DATA_NAME)
STATIC = static_dir()


def read_data():
    """Retourne le contenu brut de donnees.json, ou b'' si absent."""
    try:
        with open(DATA_FILE, "rb") as f:
            return f.read()
    except FileNotFoundError:
        return b""


def write_data(raw_bytes):
    """Écriture atomique : fichier temporaire puis remplacement."""
    # valide le JSON avant d'écrire (évite de corrompre le fichier)
    parsed = json.loads(raw_bytes.decode("utf-8"))
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(parsed, f, ensure_ascii=False, indent=1)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, DATA_FILE)


class Handler(BaseHTTPRequestHandler):
    server_version = "RevisionsColleges/1.0"

    # ------- utilitaires -------
    def _send(self, code, body=b"", ctype="text/plain; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if body:
            self.wfile.write(body)

    def log_message(self, *args):
        pass  # silencieux

    # ------- routes -------
    def do_GET(self):
        if self.path.split("?")[0] == "/api/data":
            raw = read_data()
            if not raw:
                # pas de fichier encore : le client basculera sur la graine
                return self._send(200, b"", CONTENT_TYPES[".json"])
            return self._send(200, raw, CONTENT_TYPES[".json"])
        return self._serve_static()

    def do_POST(self):
        if self.path.split("?")[0] != "/api/data":
            return self._send(404, b"not found")
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b""
        try:
            write_data(raw)
        except Exception as e:  # JSON invalide / erreur disque
            return self._send(400, ("erreur: %s" % e).encode("utf-8"))
        return self._send(200, b'{"ok":true}', CONTENT_TYPES[".json"])

    def _serve_static(self):
        path = self.path.split("?")[0]
        if path in ("/", ""):
            path = "/index.html"
        # anti path-traversal : on résout et on vérifie qu'on reste dans STATIC
        rel = path.lstrip("/")
        full = os.path.normpath(os.path.join(STATIC, rel))
        if not full.startswith(os.path.abspath(STATIC)):
            return self._send(403, b"forbidden")
        if not os.path.isfile(full):
            return self._send(404, b"not found")
        ext = os.path.splitext(full)[1].lower()
        ctype = CONTENT_TYPES.get(ext, "application/octet-stream")
        with open(full, "rb") as f:
            body = f.read()
        return self._send(200, body, ctype)


def find_port(host, start):
    import socket
    for p in range(start, start + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind((host, p))
                return p
            except OSError:
                continue
    return start


def main():
    port = find_port(HOST, PORT)
    httpd = ThreadingHTTPServer((HOST, port), Handler)
    url = "http://%s:%d/" % (HOST, port)
    print("Révisions Collèges")
    print("  Interface : " + url)
    print("  Données   : " + DATA_FILE)
    print("  (Ferme cette fenêtre pour quitter l'application.)")
    # ouvre le navigateur une fois le serveur prêt
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
