const PLAYER_GRADIENTS = [
  'linear-gradient(135deg,#5b86c2,#41609c)',
  'linear-gradient(135deg,#5bb3a3,#3f8c7f)',
  'linear-gradient(135deg,#c79a4b,#a07a32)',
];
const DM_GRADIENT = 'linear-gradient(135deg,#c2596a,#9c4150)';

/** Avatar background gradient: garnet for the DM, rotating palette for players. */
export function avatarGradient(role: string, index = 0): string {
  if (role === 'dm') return DM_GRADIENT;
  return PLAYER_GRADIENTS[index % PLAYER_GRADIENTS.length] ?? DM_GRADIENT;
}
