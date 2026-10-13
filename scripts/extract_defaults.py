from zipfile import ZipFile
from xml.etree import ElementTree as E
import json
from pathlib import Path

ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with ZipFile('家庭积分奖惩规则表.xlsx') as z:
    strings = [''.join(t.text or '' for t in s.findall('.//m:t', ns)) for s in E.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', ns)]
    def rows(sheet):
        for row in E.fromstring(z.read(f'xl/worksheets/sheet{sheet}.xml')).findall('m:sheetData/m:row', ns):
            result = {}
            for c in row:
                v = c.find('m:v', ns)
                text = v.text if v is not None else ''
                if c.get('t') == 's' and text:
                    text = strings[int(text)]
                result[''.join(x for x in c.get('r') if x.isalpha())] = text
            yield result
    categories, rules, rewards = [], [], []
    color = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444']
    category = None
    for row in rows(1):
        try:
            points = int(row.get('C', ''))
        except ValueError:
            continue
        if not row.get('B'):
            continue
        if row.get('A'):
            category = f'category-{len(categories)+1}'
            categories.append({'id': category, 'name': row['A'], 'color': color[len(categories)], 'deletedAt': None})
        rules.append({'id': f'rule-{len(rules)+1}', 'deletedAt': None, 'versions': [{'effectiveDate': None, 'name': row['B'], 'categoryId': category, 'points': points}]})
    for row in rows(2):
        a = row.get('A', '')
        if not a.endswith('积分') or not a[:-2].isdigit():
            continue
        cost = int(a[:-2])
        rewards.append({'id': f'reward-{cost}', 'deletedAt': None, 'versions': [{'id': f'reward-{cost}-v1', 'effectiveDate': None, 'cost': cost, 'text': row['B'], 'ruleNote': '80积分每周只可兑换一次；积分累计不清零，每周日统一兑换。规则由家长判断。' if cost == 80 else ''}]})
    assert len(rules) == 28 and len(rewards) == 6
    Path('src/data').mkdir(parents=True, exist_ok=True)
    Path('src/data/defaults.json').write_text(json.dumps({'categories': categories, 'rules': rules, 'rewards': rewards}, ensure_ascii=False, indent=2) + '\n')
