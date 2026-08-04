# -*- coding: utf-8 -*-
"""
解析 图书馆/新建文件夹/馆藏图书信息.xlsx -> data/seed-books.json
纯 Python 标准库（zipfile + xml），无需 openpyxl。
用法：python scripts/build_seed.py
"""
import zipfile, re, json, os, sys
import xml.etree.ElementTree as ET
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XLSX = os.path.join(ROOT, '图书馆', '新建文件夹', '馆藏图书信息.xlsx')
OUT = os.path.join(ROOT, 'data', 'seed-books.json')
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'

# 中图法首字母 -> 短分类名
CATMAP = {'I': '文学类', 'J': '艺术类', 'K': '历史', 'Z': '思政综合类'}
# 短名 -> 完整官方说明（供前端悬停显示）
CAT_FULL = {
    '文学类': '文学类（小说、散文、诗歌、戏剧及其理论）',
    '艺术类': '艺术类（美术、书法、音乐、摄影及其理论）',
    '历史': '历史（史传、图谱、文物及其理论）',
    '思政综合类': '思政综合类（党建、思政类、百科全书、词典、目录、工具书）',
}


def col_index(ref):
    m = re.match(r'([A-Z]+)', ref)
    s = 0
    for ch in m.group(1):
        s = s * 26 + (ord(ch) - 64)
    return s - 1


def load_rows(z):
    ss = [''.join(t.text or '' for t in si.iter(NS + 't'))
          for si in ET.fromstring(z.read('xl/sharedStrings.xml'))]
    rows = []
    for row in ET.fromstring(z.read('xl/worksheets/sheet1.xml')).iter(NS + 'row'):
        cells = {}
        mx = 0
        for c in row.iter(NS + 'c'):
            ci = col_index(c.attrib['r'])
            mx = max(mx, ci)
            t = c.attrib.get('t')
            v = c.find(NS + 'v')
            cells[ci] = (ss[int(v.text)] if t == 's' else v.text) if v is not None else None
        rows.append([cells.get(i) for i in range(mx + 1)])
    return rows


def g(r, i):
    return (r[i] or '').strip() if len(r) > i and r[i] is not None else ''


def clean(v):
    v = (v or '').strip()
    return '' if v in ('无', '無', '-', '—', 'N/A', 'na') else v


def main():
    z = zipfile.ZipFile(XLSX)
    rows = load_rows(z)
    books = []
    cur_cat = ''
    for r in rows:
        seq = g(r, 0)
        name = g(r, 3)
        # 分类分隔行：首列有值、非数字、无书名
        if seq and not seq.isdigit() and not name:
            for k, cat in CATMAP.items():
                if seq.startswith(k):
                    cur_cat = cat
            continue
        # 只保留真实图书行（序号为数字且有书名），跳过示例行(0)
        if not (name and seq.isdigit()):
            continue
        if seq == '0':
            continue
        call = g(r, 1)
        m = re.match(r'([A-Za-z]+)', call)
        cat = CATMAP.get(m.group(1).upper(), cur_cat) if m else cur_cat
        status = g(r, 9) or '在馆'
        avail = 1 if status == '在馆' else 0
        books.append({
            'call_no': call,
            'isbn': clean(g(r, 2)),
            'title': name,
            'author': g(r, 4),
            'publisher': g(r, 5),
            'year': clean(g(r, 6)),
            'price': clean(g(r, 7)),
            'category': cat,
            'tags': '',
            'cover': '',
            'location': '',        # 原表为空；索书号即架位，前端另行展示
            'intro': '',           # 不编造简介
            'note': g(r, 10),      # 备注：破损/缺页等
            'total': 1,
            'available': avail,
        })

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    payload = {
        'source': '馆藏图书信息.xlsx',
        'category_full': CAT_FULL,
        'count': len(books),
        'books': books,
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)

    print('已写出:', OUT)
    print('图书总数:', len(books))
    print('分类计数:', dict(Counter(b['category'] for b in books)))
    print('缺作者:', sum(1 for b in books if not b['author']))
    print('样例:', json.dumps(books[0], ensure_ascii=False))


if __name__ == '__main__':
    main()
