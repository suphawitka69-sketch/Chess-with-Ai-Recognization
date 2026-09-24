"""pages/page2.py — match history and analytics page."""
import storage
from models import ChessMatch

TITLE = "คลังประวัติเกมและบันทึกสถิติ (Match History)"


def build():
    items = storage.load()
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

