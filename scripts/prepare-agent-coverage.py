"""Read every XLSX worksheet without changing the source workbooks.
Normalize postal identifiers and deduplicate addresses into CEP coverage.
"""
import argparse, hashlib, json, re, sqlite3, unicodedata, zipfile
from decimal import Decimal, InvalidOperation
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def norm(value):
    return re.sub(r'\s+', ' ', ''.join(c for c in unicodedata.normalize('NFD', str(value)) if unicodedata.category(c) != 'Mn')).strip().upper()
def normalize_cep(value):
    text = str(value or '').strip().lstrip("'")
    if not text: return None
    if re.fullmatch(r'\d{7,8}', text): digits = text
    elif re.fullmatch(r'\d{5}-\d{3}', text): digits = text.replace('-', '')
    elif re.fullmatch(r'\d{2}\.\d{3}-\d{3}', text): digits = re.sub(r'\D', '', text)
    else:
        try:
            number = Decimal(text)
            if number != number.to_integral_value(): return None
            digits = str(int(number))
        except (InvalidOperation, ValueError): return None
    if not re.fullmatch(r'\d{7,8}', digits): return None
    digits = digits.zfill(8)
    return digits if digits != '00000000' else None

def read_strings(z):
    if 'xl/sharedStrings.xml' not in z.namelist(): return []
    result = []
    with z.open('xl/sharedStrings.xml') as source:
        for _, el in ET.iterparse(source, events=['end']):
            if el.tag.endswith('}si'):
                result.append(''.join(el.itertext())); el.clear()
    return result

def cell_value(cell, strings):
    value = cell.find('s:v', NS)
    if cell.attrib.get('t') == 's': return strings[int(value.text)] if value is not None else ''
    inline = cell.find('s:is', NS)
    if inline is not None: return ''.join(inline.itertext())
    return value.text if value is not None else ''

def read_rows(z, sheet, strings):
    with z.open(sheet) as source:
        for _, row in ET.iterparse(source, events=['end']):
            if not row.tag.endswith('}row'): continue
            values = []
            for cell in row:
                ref = cell.attrib.get('r', '')
                if ref:
                    col = 0
                    for char in re.match(r'[A-Z]+', ref)[0]: col = col * 26 + ord(char) - 64
                    while len(values) < col - 1: values.append('')
                values.append(cell_value(cell, strings))
            yield values
            row.clear()

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--folder', default='CEPS VIVO'); parser.add_argument('--output', default='.test-output/coverage'); args = parser.parse_args()
    folder, output = Path(args.folder), Path(args.output); output.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in folder.rglob('*') if p.suffix.lower() == '.xlsx' and not p.name.startswith('~$'))
    if not files: raise ValueError('Nenhuma planilha XLSX encontrada.')
    database = output / 'coverage.sqlite'; database.unlink(missing_ok=True)
    db = sqlite3.connect(database)
    db.execute('CREATE TABLE coverage (cep TEXT PRIMARY KEY, city TEXT, state TEXT, rows INTEGER NOT NULL, city_conflict INTEGER NOT NULL DEFAULT 0, state_conflict INTEGER NOT NULL DEFAULT 0)')
    upsert = '''INSERT INTO coverage (cep,city,state,rows) VALUES (?,?,?,1) ON CONFLICT(cep) DO UPDATE SET rows=rows+1,
      city_conflict=city_conflict OR (city IS NOT NULL AND excluded.city IS NOT NULL AND city<>excluded.city),
      state_conflict=state_conflict OR (state IS NOT NULL AND excluded.state IS NOT NULL AND state<>excluded.state),
      city=COALESCE(city,excluded.city),state=COALESCE(state,excluded.state)'''
    manifest = {'folder': folder.name, 'files': [], 'dataRows': 0, 'validRows': 0, 'invalidRows': 0, 'emptyRows': 0}
    for index, path in enumerate(files, 1):
        item = {'file': str(path.relative_to(folder)), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'sheets': []}
        with zipfile.ZipFile(path) as z:
            strings = read_strings(z)
            sheets = sorted(n for n in z.namelist() if re.fullmatch(r'xl/worksheets/sheet\d+\.xml', n))
            if not sheets: raise ValueError(f'Planilha sem abas: {path.name}')
            for sheet in sheets:
                headers = None; stats = {'sheet': sheet, 'rows': 0, 'valid': 0, 'invalid': 0, 'empty': 0}; batch = []
                for values in read_rows(z, sheet, strings):
                    if headers is None:
                        normalized = [norm(v) for v in values]
                        if 'CEP' not in normalized:
                            if any(normalized): raise ValueError(f'Cabeçalho CEP ausente: {path.name}/{sheet}')
                            continue
                        headers = {name: i for i, name in enumerate(normalized)}; continue
                    if not any(str(v or '').strip() for v in values): stats['empty'] += 1; continue
                    stats['rows'] += 1
                    def field(name):
                        idx = headers.get(name); return values[idx] if idx is not None and idx < len(values) else ''
                    cep = normalize_cep(field('CEP'))
                    if not cep: stats['invalid'] += 1; continue
                    city = norm(field('CIDADE')) or None; state = norm(field('UF')) or None
                    if state and not re.fullmatch(r'[A-Z]{2}', state): state = None
                    batch.append((cep, city, state)); stats['valid'] += 1
                    if len(batch) == 2000: db.executemany(upsert, batch); batch.clear()
                if headers is None: raise ValueError(f'Aba sem cabeçalho: {path.name}/{sheet}')
                if batch: db.executemany(upsert, batch)
                item['sheets'].append(stats)
                for source, target in [('rows','dataRows'),('valid','validRows'),('invalid','invalidRows'),('empty','emptyRows')]: manifest[target] += stats[source]
        db.commit(); manifest['files'].append(item)
        if index % 10 == 0 or index == len(files): print(json.dumps({'processedFiles': index, 'totalFiles': len(files), 'validRows': manifest['validRows']}), flush=True)
    manifest['uniqueCeps'] = db.execute('SELECT count(*) FROM coverage').fetchone()[0]
    manifest['duplicates'] = manifest['validRows'] - manifest['uniqueCeps']
    manifest['addressConflicts'] = db.execute('SELECT count(*) FROM coverage WHERE city_conflict OR state_conflict').fetchone()[0]
    assert db.execute('SELECT sum(rows) FROM coverage').fetchone()[0] == manifest['validRows']
    assert manifest['dataRows'] == manifest['validRows'] + manifest['invalidRows']
    manifest['sourceHash'] = hashlib.sha256(json.dumps([(f['file'],f['sha256']) for f in manifest['files']],separators=(',',':')).encode()).hexdigest()
    with (output / 'ceps.jsonl').open('w') as target:
        for cep, city, state in db.execute('SELECT cep,CASE WHEN city_conflict THEN NULL ELSE city END,CASE WHEN state_conflict THEN NULL ELSE state END FROM coverage ORDER BY cep'):
            target.write(json.dumps({'cep':cep,'city':city,'state':state},ensure_ascii=False,separators=(',',':'))+'\n')
    (output / 'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
    print(json.dumps({key:value for key,value in manifest.items() if key != 'files'}, ensure_ascii=False), flush=True); db.close()
if __name__ == '__main__': main()
