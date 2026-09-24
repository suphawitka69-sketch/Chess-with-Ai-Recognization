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


def handle(form):
    items = storage.load()
    white = form.get("white", "").strip()
    black = form.get("black", "").strip()
    opening = form.get("opening", "").strip()
    eco = form.get("eco", "").strip()
    result = form.get("result", "").strip()
    notes = form.get("notes", "").strip()

    if white == "" or black == "" or opening == "" or result == "":
        return "กรุณากรอกข้อมูลเกมให้ครบถ้วน"

    try:
        accuracy = float(form.get("accuracy", "0"))
    except ValueError:
        return "ค่า accuracy ต้องเป็นตัวเลข"

    try:
        blunders = int(form.get("blunders", "0"))
    except ValueError:
        return "จำนวน blunders ต้องเป็นตัวเลขเต็ม"

    game_id = form.get("game_id", "").strip() or f"g_{len(items) + 1:02d}"
    date = form.get("date", "").strip() or "2026-09-23"

    items.append({
        "id": len(items) + 1,
        "game_id": game_id,
        "date": date,
        "white": white,
        "black": black,
        "opening": opening,
        "eco": eco,
        "result": result,
        "accuracy": accuracy,
        "blunders": blunders,
        "notes": notes,
    })
    storage.save(items)
    return "บันทึกเกมใหม่แล้ว" 
