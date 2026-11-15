from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'extension' / 'manifest.json').read_text(encoding='utf-8'))['version']
dist = root / 'dist'
dist.mkdir(exist_ok=True)
output = dist / f'research-pocket-{version}.zip'
with ZipFile(output, 'w', compression=ZIP_DEFLATED) as archive:
    for file in sorted((root / 'extension').rglob('*')):
        if file.is_file():
            archive.write(file, 'research-pocket/' + file.relative_to(root).as_posix())
    help_html = (root / 'extension' / 'help.html').read_text(encoding='utf-8').replace('href="help.css"', 'href="extension/help.css"')
    archive.writestr('research-pocket/START.html', help_html.encode('utf-8'))
with ZipFile(output) as archive:
    assert archive.testzip() is None
    assert 'research-pocket/extension/manifest.json' in archive.namelist()
    assert not any('/qa/' in name or '/tools/' in name for name in archive.namelist())
    print(f'Packaged {len(archive.namelist())} files; {output.stat().st_size} bytes: {output}')
