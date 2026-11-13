"""InkTrace Web: python app.py; standard library only; localhost application."""

import argparse
import errno
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
from urllib.parse import urlsplit

if __name__ == '__main__' and sys.version_info < (3, 10):
    sys.exit(
        'InkTrace requires Python 3.10 or newer. '
        f'Detected Python {sys.version.split()[0]}.'
    )

try:
    from github_client import GitHubClient, GitHubError
    from svg_export import filename, generate_svg, safe_title
except ModuleNotFoundError as exc:
    if __name__ == '__main__' and exc.name in {'github_client', 'svg_export'}:
        sys.exit(f'InkTrace 找不到 {exc.name}.py。請完整解壓縮專案，並保留它和 app.py 在同一資料夾。')
    raise

ROOT = Path(__file__).resolve().parent
ASSETS = {
    '/': ('index.html', 'text/html'),
    '/index.html': ('index.html', 'text/html'),
    '/style.css': ('style.css', 'text/css'),
    '/app.js': ('app.js', 'text/javascript'),
    '/core.js': ('core.js', 'text/javascript'),
    '/store.js': ('store.js', 'text/javascript'),
    '/github.js': ('github.js', 'text/javascript'),
    '/fonts/shoujin-coverage.js': ('fonts/shoujin-coverage.js', 'text/javascript'),
    '/fonts/noto_sans_tc_thin.ttf': ('fonts/noto_sans_tc_thin.ttf', 'font/ttf'),
    '/fonts/ShoujinTi_GBK.ttf': ('fonts/ShoujinTi_GBK.ttf', 'font/ttf'),
}
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; script-src 'self'; style-src 'self'; "
    "img-src 'self' blob:; font-src 'self'; connect-src 'self' https://api.github.com; "
    "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
)


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, body, mime='application/json'):
        if isinstance(body, dict):
            body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        charset = (
            '; charset=utf-8'
            if mime.startswith('text/') or mime == 'application/json'
            else ''
        )
        self.send_header('Content-Type', mime + charset)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', CONTENT_SECURITY_POLICY)
        self.end_headers()
        self.wfile.write(body)

    def allowed(self):
        port = self.server.server_port
        return self.headers.get('Host') in {f'127.0.0.1:{port}', f'localhost:{port}'}

    def do_GET(self):
        if not self.allowed():
            return self.reply(403, {'error': '僅接受本機連線。'})
        route = urlsplit(self.path).path
        if route == '/api/github/settings':
            return self.reply(200, self.server.github.status())
        if route not in ASSETS:
            return self.reply(404, {'error': '找不到此頁面。'})
        file, mime = ASSETS[route]
        self.reply(200, (ROOT / file).read_bytes(), mime)

    def do_POST(self):
        port = self.server.server_port
        if not self.allowed() or self.headers.get('Sec-Fetch-Site') == 'cross-site':
            return self.reply(403, {'error': '請從本機網頁操作。'})
        origin = self.headers.get('Origin')
        if origin and origin not in {f'http://127.0.0.1:{port}', f'http://localhost:{port}'}:
            return self.reply(403, {'error': '不接受其他來源。'})
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.reply(415, {'error': '請使用 JSON。'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 2_000_000:
                return self.reply(413, {'error': '筆跡資料超過 2 MB。'})
            self.connection.settimeout(15)
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError('資料格式不正確。')
            route = urlsplit(self.path).path
            if route == '/api/github/settings':
                result = self.server.github.configure(
                    data.get('owner'), data.get('repo'), data.get('token')
                )
            elif route == '/api/github/clear':
                result = self.server.github.clear()
            elif route == '/api/github/check':
                result = self.server.github.check()
            elif route == '/api/export':
                safe_title(data.get('title'))
                result = {
                    'filename': filename(data.get('character')),
                    'svg': generate_svg(data.get('strokes')),
                }
            elif route == '/api/github/upload':
                result = self.server.github.upload(
                    data.get('title'), data.get('character'), data.get('strokes')
                )
            else:
                return self.reply(404, {'error': '找不到此 API。'})
            self.reply(200, result)
        except (ValueError, TypeError, UnicodeError, OverflowError) as exc:
            # Validation errors are our own messages; JSON decoder details are unnecessary.
            message = '資料格式不正確。' if isinstance(exc, json.JSONDecodeError) else str(exc)
            self.reply(400, {'error': message})
        except GitHubError as exc:
            self.reply(502, {'error': exc.message, 'githubStatus': exc.status})
        except Exception:
            self.reply(500, {'error': '處理失敗，筆跡仍保留，請稍後重試。'})


def create_server(port=8082, github=None):
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.github = github or GitHubClient()
    return server


def main():
    parser = argparse.ArgumentParser(description='InkTrace 網頁版（SVG → GitHub）')
    parser.add_argument('--port', type=int, default=8082)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('port must be between 1 and 65535')
    missing = sorted({
        file for file, mime in ASSETS.values()
        if mime != 'font/ttf' and not (ROOT / file).is_file()
    })
    if missing:
        parser.exit(1, f'缺少專案檔案：{", ".join(missing)}\n請完整解壓縮專案，並保留原本的資料夾結構。\n')
    if not (ROOT / 'fonts/noto_sans_tc_thin.ttf').is_file():
        print('缺少 fonts/noto_sans_tc_thin.ttf，灰色提示字將使用替代字型。', file=sys.stderr, flush=True)
    try:
        server = create_server(args.port)
    except OSError as exc:
        message = f'無法在 127.0.0.1:{args.port} 啟動 InkTrace：{exc}\n'
        if (
            exc.errno in {errno.EADDRINUSE, errno.EACCES}
            or getattr(exc, 'winerror', None) in {10048, 10013}
        ):
            alternative = 8083 if args.port == 8082 else 8082
            message += f'連接埠可能已被使用或保留。請試 python app.py --port {alternative}\n'
        parser.exit(1, message)
    print(f'InkTrace Web: http://127.0.0.1:{args.port}', flush=True)
    print('按 Ctrl+C 關閉。GitHub Token 僅保留於本次服務記憶體。', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
