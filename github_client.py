"""GitHub Contents API. Credentials stay in process memory. No token logging."""

import base64
import json
import re
import threading
import urllib.error
import urllib.request
from urllib.parse import quote

from svg_export import generate_svg, upload_path


class GitHubError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message
        super().__init__(message)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request_github(method, path, token, payload=None):
    body = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(
        'https://api.github.com' + path,
        data=body,
        method=method,
        headers={
            'Authorization': 'Bearer ' + token,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2026-03-10',
            'User-Agent': 'InkTrace-Web',
            'Content-Type': 'application/json',
        },
    )
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=25) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        # Do not reflect upstream payloads or credentials to the UI/logs.
        messages = {
            401: 'Token 無效或已過期。',
            403: '權限不足或 API 額度已用完，請確認 Contents 讀寫權限。',
            404: '找不到倉庫、main 分支或檔案，請確認設定與存取權限。',
            409: '檔案或分支有衝突，請稍後重試。',
            422: 'GitHub 拒絕寫入，請確認分支規則與資料。',
        }
        message = messages.get(exc.code, f'GitHub 回報 HTTP {exc.code}。')
        raise GitHubError(exc.code, message) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise GitHubError(502, '無法連線 GitHub。若上傳已送出，請檢查倉庫後再重試。') from None


class GitHubClient:
    def __init__(self, transport=request_github):
        self.transport = transport
        self._config = None
        self.lock = threading.Lock()

    def status(self):
        with self.lock:
            config = self._config
            return {
                'configured': bool(config),
                'owner': config['owner'] if config else '',
                'repo': config['repo'] if config else '',
                'branch': 'main',
            }

    def configure(self, owner, repo, token):
        if not isinstance(owner, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]{0,38}', owner):
            raise ValueError('GitHub 帳號名稱格式不正確。')
        if (
            not isinstance(repo, str)
            or not re.fullmatch(r'[A-Za-z0-9_.-]{1,100}', repo)
            or repo in ('.', '..')
        ):
            raise ValueError('倉庫名稱格式不正確。')
        if (
            not isinstance(token, str)
            or not 10 <= len(token) <= 512
            or not re.fullmatch(r'[A-Za-z0-9_]+', token)
        ):
            raise ValueError('請填入有效的 Personal Access Token。')
        with self.lock:
            self._config = {'owner': owner, 'repo': repo, 'token': token}
        return self.status()

    def clear(self):
        with self.lock:
            self._config = None
        return self.status()

    def config(self):
        if not self._config:
            raise ValueError('請先設定 GitHub。')
        return self._config.copy()

    def check_config(self, config):
        owner = quote(config['owner'], safe='')
        repo = quote(config['repo'], safe='')
        base = f'/repos/{owner}/{repo}'
        info = self.transport('GET', base, config['token'])
        if info.get('archived') or info.get('permissions', {}).get('push') is False:
            raise ValueError('倉庫唯讀或沒有寫入權限。')
        self.transport('GET', base + '/branches/main', config['token'])
        return base

    def check(self):
        with self.lock:
            self.check_config(self.config())
        return {'ok': True, 'branch': 'main'}

    def upload(self, title, character, strokes):
        svg = generate_svg(strokes)
        path = upload_path(title, character)
        # Serialize read-SHA/write pairs to avoid updates racing each other.
        with self.lock:
            config = self.config()
            token = config['token']
            base = self.check_config(config)
            endpoint = base + '/contents/' + path
            sha = None
            try:
                previous = self.transport('GET', endpoint + '?ref=main', token)
                if (
                    not isinstance(previous, dict)
                    or previous.get('type') != 'file'
                    or not previous.get('sha')
                ):
                    raise ValueError('目標路徑不是一般檔案。')
                sha = previous['sha']
            except GitHubError as exc:
                if exc.status != 404:
                    raise
            payload = {
                'message': f'Update SVG for {character}',
                'content': base64.b64encode(svg.encode()).decode(),
                'branch': 'main',
            }
            if sha:
                payload['sha'] = sha
            result = self.transport('PUT', endpoint, token, payload)
            content = result.get('content') or {}
            if not content.get('sha'):
                raise GitHubError(502, 'GitHub 未回傳檔案 SHA，請到倉庫確認，尚未標記完成。')
            owner = quote(config['owner'], safe='')
            repo = quote(config['repo'], safe='')
            return {
                'ok': True,
                'path': path,
                'sha': content['sha'],
                'url': f'https://github.com/{owner}/{repo}/blob/main/{path}',
                'destination': f'{config["owner"]}/{config["repo"]}@main',
            }
