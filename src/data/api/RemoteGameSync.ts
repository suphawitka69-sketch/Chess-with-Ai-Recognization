import type { GameSummaryRecord } from '../../shared/types/schema';

const MAIN_API_URL = 'https://chess-with-ai-recognization.onrender.com';

export async function syncGameSummary(game: GameSummaryRecord): Promise<void> {
  const response = await fetch(`${MAIN_API_URL}/api/games`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(game),
  });

  if (!response.ok) {
    throw new Error(`Remote game sync failed (${response.status})`);
  }
}