import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import { canStartMilhao } from '../src/utils/milhaoGame.js';

function guildWithRole(id, name) {
  return { roles: { cache: new Map([[id, { id, name }]]) } };
}

test('mantém acesso para quem possui a permissão nativa de administrador', () => {
  assert.equal(canStartMilhao({
    memberPermissions: { has: permission => permission === PermissionFlagsBits.Administrator },
  }), true);
});

test('permite o cargo Admin em uma interação slash', () => {
  const guild = guildWithRole('role-admin', 'Admin');
  assert.equal(canStartMilhao({
    guild,
    member: { roles: ['role-admin'] },
    memberPermissions: { has: () => false },
  }), true);
});

test('permite o cargo Administrador em uma mensagem prefixada', () => {
  const guild = guildWithRole('role-admin', 'Administrador');
  assert.equal(canStartMilhao({
    guild,
    member: { roles: { cache: new Map([['role-admin', {}]]) } },
    memberPermissions: { has: () => false },
  }), true);
});

test('não libera a criação para outros cargos', () => {
  const guild = guildWithRole('role-member', 'Membro');
  assert.equal(canStartMilhao({
    guild,
    member: { roles: ['role-member'] },
    memberPermissions: { has: () => false },
  }), false);
});
