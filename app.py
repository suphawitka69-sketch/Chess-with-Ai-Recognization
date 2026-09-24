"""app.py — GIVEN, DO NOT EDIT.

Turns every file in pages/ into a web page:

    pages/page1.py  →  http://localhost:5000/page1   rendered with templates/page1.html

A page file needs:
    TITLE = "..."                # shown in the menu
    def build():                 # runs on every visit, returns a dict for the template
    def build(query):            # same, but receives the ?a=b URL parameters as a dict
    def handle(form):            # optional, runs when the page's <form method="post"> is sent

Extras the web layer does for you (see docs/tools/flask-page.md):
  - a string returned by handle() becomes the yellow banner on the next page load
  - a "notice" key in build()'s dict is shown as the banner too
  - an uploaded file (<input type="file" name="photo">, form with enctype="multipart/form-data")
    is saved into static/img/ and form["photo"] becomes the saved file name
    (if handle() does not store that name in data.json, the file is removed again)
  - after a POST you are sent back to the same URL you came from (filters survive)
  - a page that is missing, broken, or still a TODO shows a friendly "not built yet" page
Run:  python app.py           (or  python app.py 5001  to pick another port)
"""
import importlib.util
import inspect
import json
import os
import re
import sys
import time
import traceback
from urllib.parse import urlsplit

from flask import Flask, jsonify, make_response, redirect, render_template, request, url_for

import storage

HERE = os.path.dirname(os.path.abspath(__file__))
PAGES_DIR = os.path.join(HERE, "pages")
UPLOAD_DIR = os.path.join(HERE, "static", "img")
ALLOWED_UPLOAD = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
sys.path.insert(0, HERE)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024      # 5 MB per upload


# ---------- helpers ----------
def read_json(name, default):
    path = os.path.join(HERE, name)
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def page_names():
    """page1, page2, ... in order, then everything else, team last."""
    names = [f[:-3] for f in os.listdir(PAGES_DIR) if f.endswith(".py") and not f.startswith("_")]
    numbered = sorted([n for n in names if n.startswith("page") and n[4:].isdigit()], key=lambda n: int(n[4:]))
    others = sorted(n for n in names if n not in numbered and n != "team")
    tail = ["team"] if "team" in names else []
    return numbered + others + tail


def load_page(name):
    """Import pages/<name>.py fresh every time, so edits show up on reload.
    (This also means a variable at the top of a page file does NOT survive between visits —
    keep anything that must persist in data.json.)  Returns (module, error_text)."""
    path = os.path.join(PAGES_DIR, name + ".py")
    if not os.path.exists(path):
        return None, "ไม่พบไฟล์ pages/" + name + ".py"
    try:
        spec = importlib.util.spec_from_file_location("pages." + name, path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module, None
    except Exception:
        return None, traceback.format_exc()


def nav():
    items = []
    for name in page_names():
        module, _ = load_page(name)
        title = getattr(module, "TITLE", None) if module else None
        items.append({"name": name, "title": title or name.capitalize()})
    return items


def save_uploads(files):
    """Save every uploaded file into static/img/ and return {field: saved_name}."""
    saved = {}
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    for field in files:
        f = files[field]
        if not f or not f.filename:
            continue
        base, ext = os.path.splitext(f.filename)
        ext = ext.lower()
        if ext not in ALLOWED_UPLOAD:
            saved[field] = ""          # wrong type → empty string, the page can complain
            continue
        clean = re.sub(r"[^A-Za-z0-9_-]+", "-", base).strip("-")[:40] or "file"
        name = clean + "-" + str(int(time.time())) + ext
        f.save(os.path.join(UPLOAD_DIR, name))
        saved[field] = name
    return saved


def drop_unused_uploads(uploaded):
    """An uploaded file that handle() did not store in data.json (rejected form) is removed again."""
    names = [n for n in uploaded.values() if n]
    if not names:
        return
    try:
        with open(os.path.join(HERE, "data.json"), encoding="utf-8") as f:
            stored = f.read()
    except OSError:
        stored = ""
    for n in names:
        if n not in stored:
            try:
                os.remove(os.path.join(UPLOAD_DIR, n))
            except OSError:
                pass


def back_to(name, msg=None):
    """Redirect to the page the form came from (keeps ?q=… filters), else to /<name>."""
    target = url_for("page", name=name)
    ref = request.referrer
    if ref:
        parts = urlsplit(ref)
        if parts.path == target:
            target = parts.path + ("?" + parts.query if parts.query else "")
    if msg:
        joiner = "&" if "?" in target else "?"
        target = target + joiner + "msg=" + msg
    return redirect(target)


@app.context_processor
def inject_globals():
    # ✅ กำหนดให้ชี้ไปที่ GitHub Pages ของตัวเกมเสมอ (มีตัว h: suphawit)
    chess_url = os.environ.get(
        "CHESS_URL", 
        "https://suphawitka69-sketch.github.io/Chess-with-Ai-Recognization/"
    ).strip()

    return {
        "nav": nav(),
        "team": read_json("team.json", {"group": {}, "members": []}),
        "msg": request.args.get("msg", ""),
        "chess_url": chess_url,
    }
    


def not_built(name, reason, detail=""):
    return render_template("_not_built.html", page=name, reason=reason, detail=detail), 200


def add_api_headers(response):
    if isinstance(response, (dict, list)):
        response = jsonify(response)
    else:
        response = make_response(response)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


def game_to_history_row(game):
    player_color = game.get("setup", {}).get("playerColor", "w")
    opponent = game.get("setup", {}).get("opponent", {})
    result = game.get("result", {})
    accuracy = game.get("accuracy") or {}
    counts = accuracy.get("counts") or {}
    openings = game.get("openings") or {}
    behavior = game.get("behaviorSummary") or {}
    opponent_label = opponent.get("label") or "Chess Coach"
    player_name = "Player (คุณ)"
    if player_color == "w":
        white, black = player_name, opponent_label
    else:
        white, black = opponent_label, player_name

    outcome = result.get("outcome", "draw")
    if outcome == "win":
        result_text = "1-0" if player_color == "w" else "0-1"
    elif outcome == "loss":
        result_text = "0-1" if player_color == "w" else "1-0"
    else:
        result_text = "1/2-1/2"

    notes = "เกมจาก Chess Coach"
    if behavior.get("avgPanicScore", 0) > 0.6:
        notes += " · พบช่วงกดดันสูง"

    return {
        "id": game.get("gameId"),
        "game_id": game.get("gameId", ""),
        "date": game.get("endedAt", "")[:10],
        "white": white,
        "black": black,
        "opening": openings.get("name") or "ยังไม่วิเคราะห์",
        "eco": openings.get("ecoCode") or "",
        "result": result_text,
        "accuracy": accuracy.get("playerAccuracyPct", 0),
        "blunders": counts.get("blunder", 0),
        "notes": notes,
    }


@app.route("/api/games", methods=["GET", "POST", "OPTIONS"])
def api_games():
    if request.method == "OPTIONS":
        return add_api_headers(""), 200
    if request.method == "GET":
        return add_api_headers({"games": storage.load()})

    game = request.get_json(silent=True) or request.form
    if hasattr(game, "to_dict"):
        game = game.to_dict()
    if not isinstance(game, dict) or not game.get("gameId"):
        return add_api_headers({"error": "gameId is required"}), 400

    items = storage.load()
    new_row = game_to_history_row(game)
    replaced = False
    for index, item in enumerate(items):
        if item.get("game_id") == new_row["game_id"]:
            new_row["id"] = item.get("id", index + 1)
            items[index] = new_row
            replaced = True
            break
    if not replaced:
        new_row["id"] = len(items) + 1
        items.append(new_row)
    storage.save(items)
    return add_api_headers({"success": True, "message": "บันทึกเรียบร้อย", "game": new_row}), 200


# ---------- routes ----------
@app.route("/")
def home():
    return render_template("home.html")


@app.route("/<name>", methods=["GET", "POST"])
def page(name):
    if name not in page_names():
        return not_built(name, "ไม่มีหน้านี้")

    module, error = load_page(name)
    if error:
        return not_built(name, "ไฟล์ pages/" + name + ".py มีข้อผิดพลาด", error)

    # POST → handle(form) → redirect back (with an optional message)
    if request.method == "POST":
        handler = getattr(module, "handle", None)
        if handler is None:
            return not_built(name, "หน้านี้รับฟอร์มไม่ได้: ยังไม่มี def handle(form) ใน pages/" + name + ".py")
        form = dict(request.form)
        uploaded = save_uploads(request.files)
        form.update(uploaded)
        try:
            result = handler(form)
        except NotImplementedError:
            return not_built(name, "handle() ยังเป็น TODO")
        except Exception:
            return not_built(name, "handle() พัง", traceback.format_exc())
        finally:
            drop_unused_uploads(uploaded)
        if isinstance(result, str) and result:
            return back_to(name, result)
        return back_to(name)

    # GET → build() → template
    builder = getattr(module, "build", None)
    if builder is None:
        return not_built(name, "ยังไม่มี def build() ใน pages/" + name + ".py")
    try:
        if len(inspect.signature(builder).parameters) >= 1:
            query = dict(request.args)
            query.pop("msg", None)
            context = builder(query)
        else:
            context = builder()
    except NotImplementedError:
        return not_built(name, "build() ยังเป็น TODO")
    except Exception:
        return not_built(name, "build() พัง", traceback.format_exc())

    if context is None:
        context = {}
    if not isinstance(context, dict):
        return not_built(name, "build() ต้อง return dict แต่ได้ " + type(context).__name__)

    template = name + ".html"
    if not os.path.exists(os.path.join(HERE, "templates", template)):
        return not_built(name, "ไม่พบไฟล์ templates/" + template)
    try:
        return render_template(template, title=getattr(module, "TITLE", name), page=name, **context)
    except Exception:
        return not_built(name, "templates/" + template + " มีข้อผิดพลาด", traceback.format_exc())


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    app.run(debug=True, port=port)
