from pathlib import Path
from zipfile import ZipFile
import json

root = Path(__file__).resolve().parents[2]
extension = root / 'extension'
manifest = json.loads((extension / 'manifest.json').read_text(encoding='utf-8'))
package = json.loads((root / 'package.json').read_text(encoding='utf-8'))
assert manifest['version'] == package['version']
assert manifest['permissions'] == ['sidePanel', 'scripting', 'storage', 'clipboardWrite']
assert manifest['host_permissions'] == [
    'https://www.youtube.com/*',
    'https://notebook.google.com/*',
    'https://notebooklm.google.com/*',
]
assert manifest['background']['type'] == 'module'
assert manifest['minimum_chrome_version'] == '116'

archive_path = root / 'dist' / f"research-pocket-{manifest['version']}.zip"
expected = {
    'research-pocket/' + file.relative_to(root).as_posix(): file.read_bytes()
    for file in extension.rglob('*') if file.is_file()
}
expected['research-pocket/START.html'] = (
    (extension / 'help.html').read_text(encoding='utf-8')
    .replace('href="help.css"', 'href="extension/help.css"').encode('utf-8')
)
with ZipFile(archive_path) as archive:
    assert archive.testzip() is None
    assert set(archive.namelist()) == set(expected)
    for name, content in expected.items():
        assert archive.read(name) == content, name

result = {
    'version': manifest['version'],
    'permissionsUnchanged': True,
    'packageMatchesSource': True,
    'entries': len(expected),
    'archive': str(archive_path),
}
(root / 'qa' / 'improvements' / 'package-results.json').write_text(
    json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
)
print(json.dumps(result, ensure_ascii=False))
