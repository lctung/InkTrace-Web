"""SVG geometry compatible with InkTrace Android's SvgGenerator.kt."""

import math
import re
from urllib.parse import quote


def safe_title(value):
    if not isinstance(value, str):
        raise ValueError('請輸入稿紙名稱。')
    value = value.strip()
    if (
        not 1 <= len(value.encode('utf-16-le')) // 2 <= 80
        or '..' in value
        or re.search(r'[/\\%?#\x00-\x1f\x7f-\x9f]', value)
    ):
        raise ValueError('稿紙名稱限 1–80 字，不能包含 / \\ % ? # 或 ..。')
    return value


def filename(character):
    if not isinstance(character, str) or len(character) != 1:
        raise ValueError('請選擇有效字元。')
    code_point = ord(character)
    if code_point < 32 or 0x7F <= code_point <= 0x9F or 0xD800 <= code_point <= 0xDFFF:
        raise ValueError('請選擇有效字元。')
    stem = f'U+{code_point:X}' if character in '/\\%?#.' else character
    return stem + '.svg'


def upload_path(title, character):
    directory = quote(safe_title(title), safe='')
    file = quote(filename(character), safe='')
    return f'font_dataset/{directory}/{file}'


def validate_strokes(strokes):
    if not isinstance(strokes, list) or not 1 <= len(strokes) <= 1000:
        raise ValueError('請先寫字；每字最多 1000 筆。')
    total = 0
    for line in strokes:
        if not isinstance(line, list) or not line:
            raise ValueError('筆跡格式錯誤。')
        total += len(line)
        if total > 20000:
            raise ValueError('筆跡過於複雜，請減少筆畫。')
        for point in line:
            if not isinstance(point, dict):
                raise ValueError('座標格式錯誤。')
            for key, minimum, maximum in (('x', 0, 400), ('y', 0, 400), ('width', 0.15, 24)):
                value = point.get(key)
                if (
                    type(value) not in (int, float)
                    or not math.isfinite(value)
                    or not minimum <= value <= maximum
                ):
                    raise ValueError('座標或筆粗超出範圍。')


def generate_svg(strokes):
    validate_strokes(strokes)
    points = [p for line in strokes for p in line]
    min_x = min(p['x'] - p['width'] / 2 for p in points)
    max_x = max(p['x'] + p['width'] / 2 for p in points)
    min_y = min(p['y'] - p['width'] / 2 for p in points)
    max_y = max(p['y'] + p['width'] / 2 for p in points)
    scale = 284 / max(max_x - min_x, max_y - min_y, 1)
    offset_x = (300 - (max_x - min_x) * scale) / 2 - min_x * scale
    offset_y = (300 - (max_y - min_y) * scale) / 2 - min_y * scale

    def format_coordinate(value):
        return f'{value:.5f}'.rstrip('0').rstrip('.') if value else '0'

    result = [
        '<svg xmlns="http://www.w3.org/2000/svg" '
        'viewBox="0 0 300 300" width="300" height="300">'
    ]
    for line in strokes:
        for index, point in enumerate(line):
            x = format_coordinate(point['x'] * scale + offset_x)
            y = format_coordinate(point['y'] * scale + offset_y)
            radius = format_coordinate(point['width'] * scale / 2)
            result.append(f'<circle cx="{x}" cy="{y}" r="{radius}" fill="black"/>')
            if index:
                previous = line[index - 1]
                previous_x = format_coordinate(previous['x'] * scale + offset_x)
                previous_y = format_coordinate(previous['y'] * scale + offset_y)
                width = format_coordinate((previous['width'] + point['width']) * scale / 2)
                result.append(
                    f'<path d="M {previous_x} {previous_y} L {x} {y}" stroke="black" '
                    f'stroke-width="{width}" stroke-linecap="round"/>'
                )
    return '\n'.join(result + ['</svg>'])
