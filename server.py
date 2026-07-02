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
import shutil
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PING_TOKEN = b"revisions-colleges"

# Auto-extinction : l'interface envoie un « battement de cœur » (~toutes les 3 s)
# tant qu'elle est ouverte. Sans battement pendant IDLE_TIMEOUT secondes (onglet
# fermé), le serveur s'arrête tout seul — ce qui permet une appli SANS console.
# 8 s = réactif à la fermeture, tout en survivant à un rechargement (F5) et à un
# court passage en arrière-plan.
IDLE_TIMEOUT = 8
STATE = {"last": time.time()}


def log(*args):
    """print() sûr : en mode fenêtré (--windowed) sys.stdout peut être None."""
    try:
        if sys.stdout:
            print(*args)
    except Exception:
        pass

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
    Dossier où vit donnees.json. Choisi pour être INVISIBLE (dossier système caché,
    hors du dossier de l'exe) et INDÉPENDANT de l'exécutable : on peut remplacer,
    déplacer ou renommer l'exe, les données restent au même endroit.
      - dev (non gelé) : le dossier du projet (donnees.json visible pour bidouiller).
      - Windows (exe)  : %APPDATA%\\RevisionsColleges\\ (dossier AppData, masqué).
      - macOS (.app)   : ~/Library/Application Support/RevisionsColleges/.
      - Linux          : ~/.local/share/RevisionsColleges/.
    """
    if not _frozen():
        return os.path.dirname(os.path.abspath(__file__))
    if sys.platform.startswith("win"):
        base = os.path.join(os.environ.get("APPDATA") or os.path.expanduser("~"), "RevisionsColleges")
    elif sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support/RevisionsColleges")
    else:
        base = os.path.expanduser("~/.local/share/RevisionsColleges")
    os.makedirs(base, exist_ok=True)
    return base


def migrate_legacy_data():
    """Au 1er lancement : si aucune donnée dans le nouvel emplacement caché mais
    qu'un donnees.json existe à côté de l'exe (ancien emplacement), on le récupère.
    Transition transparente pour ceux qui avaient déjà des données."""
    if not _frozen() or os.path.exists(DATA_FILE):
        return
    legacy = os.path.join(os.path.dirname(sys.executable), DATA_NAME)
    if os.path.exists(legacy):
        try:
            os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
            shutil.copy2(legacy, DATA_FILE)
            log("Données récupérées depuis l'ancien emplacement : " + legacy)
        except Exception as e:
            log("Migration ignorée : %s" % e)


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
    """Écriture atomique : fichier temporaire puis remplacement.

    Recrée le dossier de destination s'il a été supprimé entre-temps, pour que
    la sauvegarde regénère toujours donnees.json même si l'utilisateur a effacé
    le fichier (ou son dossier)."""
    # valide le JSON avant d'écrire (évite de corrompre le fichier)
    parsed = json.loads(raw_bytes.decode("utf-8"))
    os.makedirs(os.path.dirname(DATA_FILE) or ".", exist_ok=True)
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
        route = self.path.split("?")[0]
        if route == "/api/ping":
            # sert à reconnaître « notre » appli déjà lancée sur ce port
            return self._send(200, PING_TOKEN)
        if route == "/api/heartbeat":
            STATE["last"] = time.time()
            return self._send(200, b"ok")
        if route == "/api/data":
            STATE["last"] = time.time()
            raw = read_data()
            if not raw:
                # pas de fichier encore : le client basculera sur la graine
                return self._send(200, b"", CONTENT_TYPES[".json"])
            return self._send(200, raw, CONTENT_TYPES[".json"])
        return self._serve_static()

    def do_POST(self):
        if self.path.split("?")[0] != "/api/data":
            return self._send(404, b"not found")
        STATE["last"] = time.time()
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


class LocalServer(ThreadingHTTPServer):
    # Bind EXCLUSIF : pas de réutilisation d'adresse. Sur Windows, SO_REUSEADDR
    # laisse plusieurs serveurs s'empiler sur le même port → le navigateur peut
    # tomber sur la mauvaise instance et écrire donnees.json au mauvais endroit.
    # On l'interdit pour garantir une seule appli maîtresse par port.
    allow_reuse_address = False


def our_instance_running(host, port):
    """True si NOTRE application répond déjà sur ce port (endpoint /api/ping)."""
    try:
        with urllib.request.urlopen("http://%s:%d/api/ping" % (host, port), timeout=0.5) as r:
            return r.read(len(PING_TOKEN)) == PING_TOKEN
    except Exception:
        return False


def port_is_free(host, p):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((host, p))
            return True
        except OSError:
            return False


def pick_port(host, start):
    for p in range(start, start + 50):
        if port_is_free(host, p):
            return p
    return start


def main():
    # Si notre appli tourne déjà, on ne lance pas un 2e serveur : on rouvre juste
    # le navigateur sur l'instance existante.
    if our_instance_running(HOST, PORT):
        log("Application déjà lancée — réouverture du navigateur.")
        webbrowser.open("http://%s:%d/" % (HOST, PORT))
        return

    migrate_legacy_data()  # récupère d'éventuelles données de l'ancien emplacement
    port = pick_port(HOST, PORT)
    httpd = LocalServer((HOST, port), Handler)
    url = "http://%s:%d/" % (HOST, port)
    log("Révisions Collèges")
    log("  Interface : " + url)
    log("  Données   : " + DATA_FILE)
    log("  (Ferme l'onglet du navigateur pour quitter l'application.)")

    # watchdog : coupe le serveur si l'onglet est fermé (plus de battement de cœur)
    STATE["last"] = time.time()

    def watchdog():
        while True:
            time.sleep(2)
            if time.time() - STATE["last"] > IDLE_TIMEOUT:
                httpd.shutdown()
                return

    threading.Thread(target=watchdog, daemon=True).start()
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
