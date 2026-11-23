"""NEON DRIFT static server: stdlib only.

Serves index.html + game.js on 0.0.0.0:8080 and answers /healthz with "ok",
following the Boxlite deploy pattern (boxlite.ai/agent.md §1): a server.py
listening on 0.0.0.0:8080 with a /healthz endpoint, started by a supervisor
loop as PID 1 that waits for this file and then runs it.

Run:  python3 -u server.py
Check: curl http://127.0.0.1:8080/healthz   ->  ok
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
    ThreadingHTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
