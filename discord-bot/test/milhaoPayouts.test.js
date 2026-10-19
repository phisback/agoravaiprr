import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMilhaoShares } from '../src/utils/milhaoPayouts.js';

test('divide o prêmio proporcionalmente aos pontos', () => {
  const shares = calculateMilhaoShares([
    { id: 'a', correct: 4 },
    { id: 'b', correct: 6 },
  ]);

  assert.deepEqual(shares.map(({ playerId, amount, percentage }) => ({
    playerId,
    amount,
    percentage,
  })), [
    { playerId: 'a', amount: 400_000, percentage: 40 },
    { playerId: 'b', amount: 600_000, percentage: 60 },
  ]);
});

test('distribui exatamente o milhão mesmo quando as frações não são inteiras', () => {
  const shares = calculateMilhaoShares([
    { id: 'a', correct: 4 },
    { id: 'b', correct: 4 },
    { id: 'c', correct: 5 },
  ]);

  assert.equal(shares.reduce((total, share) => total + share.amount, 0), 1_000_000);
  assert.deepEqual(shares.map(share => share.amount), [307_692, 307_692, 384_616]);
});

test('pontuações zeradas não geram divisão por zero nem inventam saldo', () => {
  const shares = calculateMilhaoShares([
    { id: 'a', correct: 0 },
    { id: 'b', correct: 0 },
  ]);

  assert.deepEqual(shares.map(({ playerId, amount, percentage }) => ({
    playerId,
    amount,
    percentage,
  })), [
    { playerId: 'a', amount: 0, percentage: 0 },
    { playerId: 'b', amount: 0, percentage: 0 },
  ]);
});
