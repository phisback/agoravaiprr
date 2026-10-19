export function calculateMilhaoShares(players, prize = 1_000_000) {
  if (!Number.isSafeInteger(prize) || prize < 0) {
    throw new RangeError('O prêmio deve ser um inteiro não negativo.');
  }

  const totalPoints = players.reduce((total, player) => {
    if (!Number.isSafeInteger(player.correct) || player.correct < 0) {
      throw new RangeError('A pontuação dos participantes deve ser um inteiro não negativo.');
    }
    return total + player.correct;
  }, 0);

  const shares = players.map((player, index) => {
    const exactAmount = totalPoints ? (prize * player.correct) / totalPoints : 0;
    const amount = Math.floor(exactAmount);
    return {
      playerId: player.id,
      correct: player.correct,
      amount,
      percentage: totalPoints ? (player.correct / totalPoints) * 100 : 0,
      remainder: exactAmount - amount,
      index,
    };
  });

  let undistributed = prize - shares.reduce((total, share) => total + share.amount, 0);
  const remainderOrder = [...shares]
    .filter(share => share.correct > 0)
    .sort((a, b) => b.remainder - a.remainder || b.correct - a.correct || a.index - b.index);

  for (let index = 0; undistributed > 0 && remainderOrder.length; index += 1) {
    remainderOrder[index % remainderOrder.length].amount += 1;
    undistributed -= 1;
  }

  return shares.map(({ remainder, index, ...share }) => share);
}
