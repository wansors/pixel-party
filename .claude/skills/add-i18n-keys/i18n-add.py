#!/usr/bin/env python3
"""Concurrency-safe i18n merge for Pixel Party (see SKILL.md next to this file).

Usage: python3 .claude/skills/add-i18n-keys/i18n-add.py '<json fragment>'
  fragment = {"en": {"game": {"ns": {"key": "value"}}}, "es": {"game": {"ns": {"key": "valor"}}}}

Deep-merges the fragment into apps/client/src/assets/i18n/{en,es}.json under an exclusive file lock
(several agents/sessions can add keys at once), then re-formats both files with Biome. Both languages
are required and must carry exactly the same keys.
"""
import fcntl
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
I18N = os.path.join(ROOT, 'apps', 'client', 'src', 'assets', 'i18n')


def keys(d, prefix=''):
    out = set()
    for k, v in d.items():
        p = f'{prefix}.{k}' if prefix else k
        out |= keys(v, p) if isinstance(v, dict) else {p}
    return out


def merge(dst, src):
    for k, v in src.items():
        if isinstance(v, dict):
            node = dst.setdefault(k, {})
            if not isinstance(node, dict):
                sys.exit(f'error: "{k}" is a string in the target file, cannot nest under it')
            merge(node, v)
        else:
            dst[k] = v


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    frag = json.loads(sys.argv[1])
    if set(frag) != {'en', 'es'}:
        sys.exit('error: fragment must have exactly the top-level keys "en" and "es"')
    diff = keys(frag['en']) ^ keys(frag['es'])
    if diff:
        sys.exit(f'error: en/es key mismatch: {sorted(diff)}')

    with open(os.path.join(tempfile.gettempdir(), 'pixel-party-i18n.lock'), 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        files = []
        for lang in ('en', 'es'):
            path = os.path.join(I18N, f'{lang}.json')
            with open(path, encoding='utf-8') as f:
                data = json.load(f)
            merge(data, frag[lang])
            with open(path, 'w', encoding='utf-8') as f:
                f.write(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
            files.append(path)
        subprocess.run(['bunx', 'biome', 'format', '--write', *files], cwd=ROOT, check=True,
                       capture_output=True)
    print('merged', sorted(keys(frag['en'])))


if __name__ == '__main__':
    main()
