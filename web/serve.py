"""Dev server for the rdoc web app.

Same as `python -m http.server 8741`, plus `Cache-Control: no-cache` on
every response: plain http.server sends only Last-Modified, so Chrome's
heuristic freshness serves stale wasm/js modules for minutes after a
rebuild (the `?v=` busting on index.html never reaches module imports).
no-cache forces revalidation — unchanged files still come back 304.

Run from web/:  python serve.py  ->  http://localhost:8741
"""
import http.server


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    http.server.test(HandlerClass=NoCacheHandler, port=8741)
