"""Refresh ?v=<hash> cache-busting suffixes after editing cabinet files.
Run from the repo root: python3 scripts/bust.py"""
import hashlib, re, pathlib
R = pathlib.Path(__file__).resolve().parent.parent
h = lambda p: hashlib.sha256((R / p).read_bytes()).hexdigest()[:12]
def sub(file, name, target):
    f = R / file; s = f.read_text()
    n = re.sub(re.escape(name) + r'\?v=[0-9a-f]{6,}', name + '?v=' + h(target), s)
    if n != s: f.write_text(n); print('updated', file, name)
# core.mjs first: bridge.js and app.js embed its hash, so their own hashes change after
sub('www/creator/bridge.js', 'core.mjs', 'www/creator/core.mjs')
sub('creator/creator/app.js', 'core.mjs', 'creator/creator/core.mjs')
sub('www/index.html', 'bridge.js', 'www/creator/bridge.js')
for name in ['app.js', 'app.css', 'creator-translations.js']:
    sub('creator/index.html', name, 'creator/creator/' + name)
