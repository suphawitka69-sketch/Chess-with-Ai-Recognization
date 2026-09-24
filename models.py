"""models.py — chess match model for the analytics project."""


class ChessMatch:
    def __init__(self, data):
        self.id = data.get("id", 0)
        self.game_id = data.get("game_id", "")
        self.date = data.get("date", "")
        self.white = data.get("white", "")
        self.black = data.get("black", "")
        self.opening = data.get("opening", "")
        self.eco = data.get("eco", "")
        self.result = data.get("result", "")
        self.accuracy = float(data.get("accuracy", 0.0))
        self.blunders = int(data.get("blunders", 0))
        self.notes = data.get("notes", "")

    def is_high_accuracy(self):
        if self.accuracy >= 75.0:
            return True
        return False

    def get_result_badge(self):
        if self.result == "1-0":
            return {"label": "ขาวชนะ", "color": "success"}
        if self.result == "0-1":
            return {"label": "ดำชนะ", "color": "danger"}
        return {"label": "เสมอ", "color": "secondary"}

    def count_eval_tags(self, tags):
        matched = 0
        for tag in tags:
            if tag.lower() in self.notes.lower():
                matched += 1
        return matched

    def get_summary(self):
        if self.is_high_accuracy():
            status = "เล่นได้ดี"
        else:
            status = "ต้องปรับปรุง"
        return f"{self.white} vs {self.black} · {self.opening} · {status}"


Item = ChessMatch
