"""python -B -m unittest -v test_app. No real GitHub traffic or credentials."""

import base64
import http.client
import json
from pathlib import Path
import threading
import unittest
import xml.etree.ElementTree as ET

from app import create_server
from github_client import GitHubClient, GitHubError
from svg_export import generate_svg, upload_path

STROKES = [
    [{'x': 100, 'y': 80, 'width': 12}, {'x': 300, 'y': 320, 'width': 12}],
    [{'x': 200, 'y': 200, 'width': 6}],
]
TOKEN = 'test_token_not_a_real_credential'


class FakeGitHub:
    def __init__(self, exists=False, error=None):
        self.exists, self.error, self.calls = exists, error, []

    def __call__(self, method, path, token, payload=None):
        self.calls.append((method, path, token, payload))
        if '/contents/' not in path:
            return {'permissions': {'push': True}}
        if method == 'GET':
            if self.error:
                raise GitHubError(self.error, '模擬失敗')
            if not self.exists:
                raise GitHubError(404, '不存在')
            return {'type': 'file', 'sha': 'old-sha'}
        return {'content': {'sha': 'new-sha'}}


def configured(fake):
    client = GitHubClient(fake)
    client.configure('student', 'inktrace-data', TOKEN)
    return client


class SVGTests(unittest.TestCase):
    def test_dimensions_and_ink_only(self):
        root = ET.fromstring(generate_svg(STROKES))
        self.assertEqual(root.attrib, {'viewBox': '0 0 300 300', 'width': '300', 'height': '300'})
        self.assertEqual(len(root.findall('{*}circle')), 3)
        self.assertEqual(len(root.findall('{*}path')), 1)
        self.assertFalse(root.findall('{*}text'))
        self.assertFalse(root.findall('{*}rect'))
        self.assertEqual({n.attrib.get('fill') for n in root.findall('{*}circle')}, {'black'})
        circles = root.findall('{*}circle')
        top = min(float(c.attrib['cy']) - float(c.attrib['r']) for c in circles)
        bottom = max(float(c.attrib['cy']) + float(c.attrib['r']) for c in circles)
        self.assertAlmostEqual(top, 8, places=4)
        self.assertAlmostEqual(bottom, 292, places=4)

    def test_dot_and_pressure(self):
        root = ET.fromstring(generate_svg([[{'x': 30, 'y': 70, 'width': 3}]]))
        dot = root.find('{*}circle')
        self.assertEqual(float(dot.attrib['cx']), 150)
        self.assertEqual(float(dot.attrib['cy']), 150)
        self.assertEqual(float(dot.attrib['r']), 142)
        pressure_strokes = [[
            {'x': 20, 'y': 20, 'width': 2},
            {'x': 300, 'y': 300, 'width': 12},
        ]]
        root = ET.fromstring(generate_svg(pressure_strokes))
        radii = [float(c.attrib['r']) for c in root.findall('{*}circle')]
        self.assertAlmostEqual(radii[1] / radii[0], 6, places=4)

    def test_paths_match_android(self):
        self.assertEqual(
            upload_path('測試 稿紙', '天'),
            'font_dataset/%E6%B8%AC%E8%A9%A6%20%E7%A8%BF%E7%B4%99/%E5%A4%A9.svg',
        )
        self.assertTrue(upload_path('稿紙', '?').endswith('U%2B3F.svg'))
        self.assertTrue(upload_path('稿紙', '𠀀').endswith('%F0%A0%80%80.svg'))
        for value in ('../x', 'foo/bar', 'x%20', '', 'x\n'):
            if value == 'x\n':
                continue  # Android trims title edges too.
            with self.assertRaises(ValueError):
                upload_path(value, '天')

    def test_invalid_geometry(self):
        invalid_strokes = (
            [], None, [[]],
            [[{'x': float('nan'), 'y': 20, 'width': 12}]],
            [[{'x': 500, 'y': 20, 'width': 12}]],
            [[{'x': 2, 'y': 3, 'width': 0}]],
            [STROKES[0] * 10001],
        )
        for lines in invalid_strokes:
            with self.subTest(value=str(lines)[:40]), self.assertRaises(ValueError):
                generate_svg(lines)


class GitHubTests(unittest.TestCase):
    def test_create_uses_base64_and_main(self):
        fake = FakeGitHub()
        client = configured(fake)
        result = client.upload('稿紙', '天', STROKES)
        self.assertTrue(result['ok'])
        method, path, token, body = fake.calls[-1]
        self.assertEqual(method, 'PUT')
        self.assertEqual(token, TOKEN)
        self.assertEqual(body['branch'], 'main')
        self.assertNotIn('sha', body)
        self.assertEqual(base64.b64decode(body['content']).decode(), generate_svg(STROKES))
        self.assertTrue(fake.calls[-2][1].endswith('?ref=main'))
        self.assertNotIn('token', client.status())

    def test_update_uses_sha(self):
        fake = FakeGitHub(exists=True)
        configured(fake).upload('稿紙', '天', STROKES)
        self.assertEqual(fake.calls[-1][3]['sha'], 'old-sha')

    def test_403_never_attempts_put(self):
        fake = FakeGitHub(error=403)
        with self.assertRaises(GitHubError):
            configured(fake).upload('稿紙', '天', STROKES)
        self.assertFalse(any(call[0] == 'PUT' for call in fake.calls))

    def test_failure_not_success_and_credentials_cleared(self):
        def reject(method, path, token, payload=None):
            if method == 'PUT':
                raise GitHubError(409, 'conflict')
            if '/contents/' in path:
                return {'type': 'file', 'sha': 'old'}
            return {}
        client = configured(reject)
        with self.assertRaises(GitHubError):
            client.upload('稿紙', '天', STROKES)
        client.clear()
        self.assertFalse(client.status()['configured'])
        with self.assertRaises(ValueError):
            client.upload('稿紙', '天', STROKES)


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fake = FakeGitHub()
        cls.server = create_server(0, configured(cls.fake))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, method, path, data=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        body = None if data is None else json.dumps(data)
        default_headers = {'Content-Type': 'application/json'} if data is not None else {}
        connection.request(method, path, body, headers or default_headers)
        response = connection.getresponse()
        status = response.status
        result = response.read()
        response_headers = dict(response.getheaders())
        connection.close()
        return status, result, response_headers

    def test_pages_fonts_and_no_source_leak(self):
        asset_paths = (
            '/', '/style.css', '/app.js', '/core.js', '/store.js', '/github.js',
            '/fonts/noto_sans_tc_thin.ttf', '/fonts/ShoujinTi_GBK.ttf',
            '/fonts/shoujin-coverage.js',
        )
        for path in asset_paths:
            status, body, headers = self.request('GET', path)
            self.assertEqual(status, 200, path)
            self.assertTrue(body)
            self.assertIn('Content-Security-Policy', headers)
        for path in ('/app.py', '/../github_client.py'):
            self.assertEqual(self.request('GET', path)[0], 404)

    def test_export_upload_and_secret_redaction(self):
        body = {'title': '稿紙', 'character': '天', 'strokes': STROKES}
        status, raw, _ = self.request('POST', '/api/export', body)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)['filename'], '天.svg')
        ET.fromstring(json.loads(raw)['svg'])
        self.assertEqual(self.request('POST', '/api/github/upload', body)[0], 200)
        status, raw, _ = self.request('GET', '/api/github/settings')
        self.assertEqual(status, 200)
        self.assertNotIn(TOKEN.encode(), raw)
        self.assertNotIn(b'"token"', raw)

    def test_invalid_input_and_origin(self):
        self.assertEqual(self.request('POST', '/api/export', {})[0], 400)
        self.assertEqual(self.request('GET', '/', headers={'Host': 'evil.invalid'})[0], 403)
        cross_origin_headers = {
            'Content-Type': 'application/json',
            'Origin': 'https://evil.invalid',
        }
        self.assertEqual(self.request('POST', '/api/export', {}, cross_origin_headers)[0], 403)
        self.assertEqual(
            self.request('POST', '/api/export', {}, {'Content-Type': 'text/plain'})[0],
            415,
        )


if __name__ == '__main__':
    unittest.main()
