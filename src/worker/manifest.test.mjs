import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chosenIcon, manifestFor } from './manifest.ts';

const source = await readFile(new URL('../../public/manifest.webmanifest', import.meta.url), 'utf8');

test('the manifest keeps its URL and switches only the icons to the chosen variant', () => {
  const manifest = JSON.parse(manifestFor(source, 'theme=dark; app_icon=rubi; other=1'));
  assert.deepEqual(manifest.icons.map(({ src }) => src), [
    '/icons/rubi/icon-192.png?v=4',
    '/icons/rubi/icon-512.png?v=4',
    '/icons/rubi/icon-maskable.png?v=4',
  ]);
  assert.equal(manifest.icons[2].purpose, 'maskable');
  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/');
});

test('unknown or missing choices fall back to the default icon', () => {
  assert.equal(chosenIcon(null), 'esmeralda');
  assert.equal(chosenIcon('app_icon=../../etc'), 'esmeralda');
  assert.equal(chosenIcon('app_icon=safira'), 'safira');
  assert.equal(JSON.parse(manifestFor(source, null)).icons[0].src, '/icons/icon-192.png?v=4');
});
