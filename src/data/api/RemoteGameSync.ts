import type { GameSummaryRecord } from '../../shared/types/schema';

const PUBLIC_BACKEND_URL = 'https://chess-with-ai-recognization.onrender.com';

function getGamesEndpoint(): string {
  const configuredBackendUrl = import.meta.env.VITE_BACKEND_URL?.trim();
  if (configuredBackendUrl) return `${configuredBackendUrl.replace(/\/$/, '')}/api/games`;

  if (window.location.origin === 'http://localhost:5000' || window.location.origin === PUBLIC_BACKEND_URL) {
    return '/api/games';
  }

  return `${PUBLIC_BACKEND_URL}/api/games`;
}

function broadcastGameOver(game: GameSummaryRecord): void {
  const message = { type: 'CHESS_GAME_OVER', payload: game };
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(message, '*');
  }
  if (window.opener) {
    window.opener.postMessage(message, '*');
  }
}

export async function syncGameSummary(game: GameSummaryRecord): Promise<void> {
  let syncError: unknown = null;
  try {
    const response = await fetch(getGamesEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(game),
    });

    if (!response.ok) {
      throw new Error(`Remote game sync failed (${response.status})`);
    }
  } catch (error) {
    syncError = error;
  }

  broadcastGameOver(game);
  if (syncError) throw syncError;
}