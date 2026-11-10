# TEMP: serves the app like `python3 -m http.server` and appends trail API timing
# entries POSTed by app.js to tests/trail_api_timing.txt. Delete when done debugging.
# Run from the project root:  python3 tests/timing_server.py [port]   (default 8000)
import http.server
import os
import sys
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG_FILE = os.path.join(ROOT, 'tests', 'trail_api_timing.txt')


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_POST(self):
        if self.path != '/__trail-timing':
            self.send_error(404)
            return
        line = self.rfile.read(int(self.headers.get('Content-Length', 0))).decode('utf-8', 'replace')
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(f"[{datetime.now().isoformat(timespec='seconds')}] {line.strip()}\n")
        self.send_response(204)
        self.end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f'Serving {ROOT} at http://localhost:{port} — logging to {LOG_FILE}')
    http.server.ThreadingHTTPServer(('', port), Handler).serve_forever()
