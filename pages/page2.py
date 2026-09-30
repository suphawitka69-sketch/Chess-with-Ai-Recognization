"""pages/page2.py — match history and analytics page."""
import json
import os
from urllib.request import Request, urlopen

from models import ChessMatch

TITLE = "คลังประวัติเกมและบันทึกสถิติ (Match History)"
BACKEND_URL = os.environ.get(
    "BACKEND_URL",
    "https://chess-with-ai-recognization.onrender.com",
).strip().rstrip("/")


def load_games():
    request = Request(f"{BACKEND_URL}/api/games", headers={"Accept": "application/json"})
    with urlopen(request, timeout=5) as response:
        payload = json.load(response)
    return payload.get("games", [])


def build():
    items = load_games()
    matches = []
    total_accuracy = 0.0
    high_accuracy_count = 0

    for row in items:
        match = ChessMatch(row)
        matches.append(match)
        total_accuracy += match.accuracy
        if match.is_high_accuracy():
            high_accuracy_count += 1

    total_games = len(matches)
    avg_accuracy = round(total_accuracy / total_games, 2) if total_games else 0.0

    return {
        "matches": matches,
        "total_games": total_games,
        "avg_accuracy": avg_accuracy,
        "high_accuracy_count": high_accuracy_count,
    }

