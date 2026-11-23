"""NEON DRIFT (SPACEMAN variant) static server: stdlib only.

Serves index.html + game.js on 0.0.0.0:8081 and answers /healthz with "ok".
Port 8081 (not 8080) so it runs alongside the ship version on the same box
(ecen-work: ship on /srv/game:8080, spaceman on /srv/spaceman:8081).

Run:  python3 -u server.py
Check: curl http://127.0.0.1:8081/healthz   ->  ok
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/healthz':
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'ok')
        else:
            super().do_GET()

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', 8081), Handler).serve_forever()
