import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVipRoleIconInput } from '../src/utils/vipRoleIcons.js';

const EMOJI_ID = '123456789012345678';

test('mantém o ícone atual quando o campo fica vazio', () => {
  assert.deepEqual(parseVipRoleIconInput(''), {
    icon: undefined,
    unicodeEmoji: undefined,
  });
});

test('converte emoji personalizado estático em imagem CDN do Discord', () => {
  assert.deepEqual(parseVipRoleIconInput(`<:estrela:${EMOJI_ID}>`), {
    icon: `https://cdn.discordapp.com/emojis/${EMOJI_ID}.png`,
    unicodeEmoji: null,
  });
});

test('converte emoji personalizado animado em imagem GIF do Discord', () => {
  assert.deepEqual(parseVipRoleIconInput(`<a:estrela:${EMOJI_ID}>`), {
    icon: `https://cdn.discordapp.com/emojis/${EMOJI_ID}.gif`,
    unicodeEmoji: null,
  });
});

test('aceita ID de emoji como ícone estático', () => {
  assert.deepEqual(parseVipRoleIconInput(EMOJI_ID), {
    icon: `https://cdn.discordapp.com/emojis/${EMOJI_ID}.png`,
    unicodeEmoji: null,
  });
});

test('envia emoji Unicode pelo campo próprio do cargo', () => {
  assert.deepEqual(parseVipRoleIconInput('✨'), {
    icon: null,
    unicodeEmoji: '✨',
  });
});

test('usa a imagem enviada e remove qualquer emoji Unicode anterior', () => {
  const url = 'https://cdn.discordapp.com/attachments/123/456/icon.png';
  assert.deepEqual(parseVipRoleIconInput('', { url }), {
    icon: url,
    unicodeEmoji: null,
  });
});

test('remover limpa a imagem e o emoji do cargo', () => {
  assert.deepEqual(parseVipRoleIconInput('remover'), {
    icon: null,
    unicodeEmoji: null,
  });
});
