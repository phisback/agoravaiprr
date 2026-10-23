import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAssumeTicket,
  canCloseTicket,
} from '../src/utils/ticketPermissions.js';

const TEAM_ROLE_ID = 'team-role';
const OTHER_ROLE_ID = 'other-role';
const TICKET = { claimedBy: 'assigned-staff' };

test('membro sem cargo da equipe não pode assumir ticket', () => {
  assert.equal(
    canAssumeTicket({ roles: [OTHER_ROLE_ID] }, [TEAM_ROLE_ID]),
    false,
  );
});

test('membro com cargo de ping pode assumir ticket', () => {
  assert.equal(
    canAssumeTicket({ roles: [TEAM_ROLE_ID] }, [TEAM_ROLE_ID]),
    true,
  );
});

test('cargo de atendimento funciona com o cache de cargos do Discord', () => {
  assert.equal(
    canAssumeTicket({ roles: { cache: new Map([[TEAM_ROLE_ID, { id: TEAM_ROLE_ID }]]) } }, [TEAM_ROLE_ID]),
    true,
  );
});

test('quem assumiu ou tem cargo de atendimento pode fechar', () => {
  assert.equal(canCloseTicket(TICKET, 'assigned-staff', { roles: [] }, [TEAM_ROLE_ID]), true);
  assert.equal(canCloseTicket(TICKET, 'team-staff', { roles: [TEAM_ROLE_ID] }, [TEAM_ROLE_ID]), true);
});

test('membro comum não pode fechar ticket assumido por outra pessoa', () => {
  assert.equal(canCloseTicket(TICKET, 'regular-member', { roles: [OTHER_ROLE_ID] }, [TEAM_ROLE_ID]), false);
});
