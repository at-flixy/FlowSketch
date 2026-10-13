"""Independent archive readback, without extracting or launching the payload."""
import hashlib, json, pathlib, zipfile
root = pathlib.Path(__file__).resolve().parent.parent
archive = root / 'prototype/FlowSketch-0.1-prototype-windows-x64.zip'
with zipfile.ZipFile(archive) as z:
    members = {n.replace('\\', '/'): n for n in z.namelist() if not n.endswith(('/', '\\'))}
    manifest = json.loads(z.read(members['windows-x64/manifest.json']))
    expected = {('windows-x64/' + f['path']): f for f in manifest['files']}
    assert set(members) == set(expected) | {'windows-x64/manifest.json'}, 'Archive file set differs from manifest'
    for name, info in expected.items():
        data = z.read(members[name])
        assert len(data) == info['bytes'], name
        assert hashlib.sha256(data).hexdigest() == info['sha256'], name
report = {'success': True, 'filesVerified': len(expected), 'bytes': archive.stat().st_size,
          'archiveSha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'cleanWindows': False}
(root / 'spikes/tauri/evidence/archive-verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
