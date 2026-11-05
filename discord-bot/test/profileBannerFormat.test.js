import test from 'node:test';
import assert from 'node:assert/strict';
import { isGifProfileBanner } from '../src/utils/profileBannerFormat.js';

test('detecta GIF pelo conteúdo persistido mesmo sem URL pública', () => {
  assert.equal(isGifProfileBanner({ imageBuffer: Buffer.from('GIF89a') }), true);
});

test('detecta GIF pela extensão da URL e ignora outros formatos', () => {
  assert.equal(isGifProfileBanner({ imageUrl: 'https://cdn.example/banner.gif?size=800' }), true);
  assert.equal(isGifProfileBanner({ imageUrl: 'https://cdn.example/banner.png' }), false);
});
