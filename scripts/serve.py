#!/usr/bin/env python
"""Loopback-only gallery server with an identity check and occupied-port fallback."""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
import json
from pathlib import Path
import urllib.request
import webbrowser
from urllib.parse import urlsplit, unquote
from _paths import GAL

IDENTITY = str(Path(GAL).resolve())


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/__pose_index_health':
            blob = json.dumps({'app': 'pose-index', 'root': IDENTITY}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(blob)))
            self.end_headers()
            self.wfile.write(blob)
            return
        request_path = unquote(urlsplit(self.path).path)
        if request_path == '/':
            self.path = '/index.html'
        elif request_path == '/gallery.html':
            self.path = '/index.html'
        elif request_path != '/index.html' and not request_path.startswith('/assets/'):
            self.send_error(404)
            return
        if '..' in Path(request_path).parts or '\\' in request_path:
            self.send_error(403)
            return
        super().do_GET()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def list_directory(self, path):
        self.send_error(403, 'Directory listing disabled')
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8899)
    parser.add_argument('--no-open', action='store_true')
    args = parser.parse_args()
    if not Path(GAL, 'index.html').is_file():
        raise SystemExit('Build the gallery first: python scripts/build.py')
    for port in range(args.port, min(args.port + 20, 65536)):
        try:
            server = ThreadingHTTPServer(('127.0.0.1', port), partial(Handler, directory=GAL))
            break
        except OSError:
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{port}/__pose_index_health', timeout=.5) as response:
                    health = json.load(response)
                if health == {'app': 'pose-index', 'root': IDENTITY}:
                    if not args.no_open:
                        webbrowser.open(f'http://127.0.0.1:{port}/index.html')
                    return
            except Exception:
                pass
            # Reuse the old launcher only if it serves the exact current gallery.
            # This preserves the browser origin (and existing local favourites).
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{port}/index.html', timeout=1) as response:
                    same_gallery = response.read() == Path(GAL, 'index.html').read_bytes()
                if same_gallery:
                    if not args.no_open:
                        webbrowser.open(f'http://127.0.0.1:{port}/index.html')
                    return
            except Exception:
                pass
    else:
        raise SystemExit('No free port in the selected range. Double-click index.html instead.')
    print(f'Pose Index: http://127.0.0.1:{port}/index.html (Ctrl+C to stop)', flush=True)
    if not args.no_open:
        webbrowser.open(f'http://127.0.0.1:{port}/index.html')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
