"""serve.py — run the website on your computer.

    py serve.py          (Windows)
    python3 serve.py     (Mac / Linux)

Then open http://localhost:5501 in your browser. Press Ctrl+C to stop.

Why not just "python -m http.server"? Browsers keep old copies of pages,
so after downloading a new version you might still see the old one.
This tiny server tells the browser "never keep a copy" (Cache-Control:
no-store), so you always see the latest files. No packages needed.
"""
import functools
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5501
SITE_FOLDER = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


handler = functools.partial(NoCacheHandler, directory=SITE_FOLDER)
with http.server.ThreadingHTTPServer(("", PORT), handler) as server:
    print(f"Chitrashala is running at http://localhost:{PORT}  (press Ctrl+C to stop)")
    server.serve_forever()
