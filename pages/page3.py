"""
pages/page3.py
ระบบ Google + YouTube หมากรุก: สารานุกรมรูปเปิด, ระบบสืบค้นแบบเรียลไทม์
และอัลกอริทึมจัดฟีดวิดีโอแนะนำส่วนบุคคล (Personalized Feed) อิงจากจุดอ่อนในโปรไฟล์จริง
"""

from storage import load

TITLE = "สารานุกรมรูปเปิดและคิดเชิงระบบ (Systems Thinking Guide)"

def build():
    # 1. คลังวิดีโอและบทเรียนทั้งหมด (All Video Database)
    all_openings = [
        {
            "id": "italian",
            "name": "Italian Game (อิตาเลียน)",
            "eco": "C50",
            "category": "สายบุกเร็ว",
            "badge_color": "danger",
            "moves": "1. e4 e5 2. Nf3 Nc6 3. Bc4",
            "youtube_id": "cpOn-G3hxdY",
            "summary": "การพัฒนาตัวหมากอย่างรวดเร็ว เล็งจุดอ่อน f7 และสร้างการไหลคุมศูนย์กลาง",
            "key_plan": "เน้นคุมช่อง d4, c3 และเตรียมเข้าป้อมเพื่อรักษาความปลอดภัยของคิง",
            "tunnel_trap": "⚠️ กับดักมองแคบ: รีบนำบิชอปไปแลก หรือผลักเบี้ยไล่คู่ต่อสู้จนหน้าคิงเปิดโล่ง",
            "systems_lesson": "🧠 คิดเชิงระบบ: พัฒนาหมากให้ประสานงานกันก่อนเริ่มโจมตี ความปลอดภัยของคิงสำคัญกว่าการรีบกินเบี้ย"
        },
        {
            "id": "sicilian",
            "name": "Sicilian Defense (ซิซิเลียน ดีเฟนส์)",
            "eco": "B20",
            "category": "สายตั้งรับเชิงรุก",
            "badge_color": "warning",
            "moves": "1. e4 c5",
            "youtube_id": "qM4e7g2RukI",
            "summary": "การตั้งรับที่ไม่สมมาตร เพื่อสร้างโอกาสสวนกลับและแย่งการคุมพื้นที่ปีกควีน",
            "key_plan": "ยอมเสียเปรียบพื้นที่ช่วงแรกเพื่อแลกเบี้ยริมกระดานกับเบี้ยกลางกระดานของขาวในระยะยาว",
            "tunnel_trap": "⚠️ กับดักมองแคบ: จดจ่อกับการบุกปีกควีนจนลืมระวังการบุกทะลวงกลางกระดานของฝ่ายขาว",
            "systems_lesson": "🧠 คิดเชิงระบบ: การยอมรับความไม่สมดุลของระบบเพื่อสร้างความได้เปรียบในอนาคต (Dynamic Imbalance)"
        },
        {
            "id": "queens_gambit",
            "name": "Queen's Gambit (ควีนส์ แกมบิต)",
            "eco": "D06",
            "category": "สายคุมโครงสร้าง",
            "badge_color": "primary",
            "moves": "1. d4 d5 2. c4",
            "youtube_id": "mtsabsZ4wG4",
            "summary": "การสละเบี้ยปีกควีนชั่วคราว เพื่อยึดครองพื้นที่ศูนย์กลางกระดานอย่างเบ็ดเสร็จ",
            "key_plan": "ล่อให้ดำกินเบี้ย c4 แล้วฝ่ายขาวจะได้คุมช่อง d4, e4 เต็มพื้นที่ พร้อมดึงเบี้ยกลับคืน",
            "tunnel_trap": "⚠️ กับดักมองแคบ: ฝ่ายดำมักดันทุรังรักษาเบี้ย c4 ที่กินมาได้ จนทำให้หมากตัวอื่นไม่ได้รับการพัฒนา",
            "systems_lesson": "🧠 คิดเชิงระบบ (Prophylaxis): เข้าใจคุณค่าของ 'การสละวัตถุเพื่อแลกตำแหน่งการไหลของหมาก (Space & Harmony)'"
        }
    ]

    # 2. วิเคราะห์นิสัยจากประวัติจริงก่อนจัดอันดับคลิปแนะนำ
    raw_history = load()
    habit_profile = build_habit_profile(raw_history)
    personalized_feed = build_personalized_feed(all_openings, raw_history, habit_profile)

    # หมวดหมู่สำหรับ Filter Chips
    categories = ["ทั้งหมด", "⚡ แนะนำสำหรับคุณ", "สายบุกเร็ว", "สายตั้งรับเชิงรุก", "สายคุมโครงสร้าง"]

    # ✅ คืนค่า dict โดยไม่มี "title" ซ้ำ (ป้องกัน TypeError)
    return {
        "all_openings": all_openings,
        "personalized_feed": personalized_feed,
        "categories": categories,
        "total_openings": len(all_openings),
        "habit_profile": habit_profile,
    }


def build_habit_profile(history):
    """สรุปเฉพาะนิสัยที่มีหลักฐานจากเกมจริง ไม่ฟันธงเมื่อข้อมูลยังน้อยเกินไป."""
    if not history:
        return {
            "has_data": False,
            "sample_count": 0,
            "headline": "ยังไม่มีข้อมูลนิสัยเพียงพอ",
            "detail": "เล่นและบันทึกอย่างน้อย 3 เกมก่อน ระบบจึงจะเริ่มจับรูปแบบการเล่นซ้ำๆ",
            "habits": [],
        }

    total = len(history)
    blunder_games = sum(int(game.get("blunders", 0) or 0) > 0 for game in history)
    low_accuracy_games = sum(float(game.get("accuracy", 100) or 100) < 75 for game in history)
    panic_games = sum("กดดัน" in str(game.get("notes", "")) for game in history)
    tunnel_games = sum("Tunnel Vision" in str(game.get("notes", "")) for game in history)
    habits = []

    if blunder_games or low_accuracy_games or panic_games:
        habits.append({
            "key": "time_pressure",
            "title": "ตัดสินใจพลาดเมื่อเกมกดดัน",
            "evidence": f"พบเกมที่มี blunder/ความแม่นยำต่ำ {max(blunder_games, low_accuracy_games, panic_games)} จาก {total} เกม",
            "recommendation": "ฝึกหยุดเช็กความปลอดภัยของคิงและการตอบโต้ก่อนเดิน",
            "opening_id": "italian",
        })
    if tunnel_games:
        habits.append({
            "key": "tunnel_vision",
            "title": "โฟกัสการบุกด้านเดียวจนพลาดการตอบโต้",
            "evidence": f"บันทึกเกมที่ระบุ Tunnel Vision {tunnel_games} จาก {total} เกม",
            "recommendation": "ฝึกมองภัยคุกคามของคู่ต่อสู้ก่อนเดินแผนของตัวเอง",
            "opening_id": "sicilian",
        })

    return {
        "has_data": True,
        "sample_count": total,
        "headline": "คำแนะนำจากนิสัยการเล่นของคุณ",
        "detail": "ระบบใช้ข้อมูลเกมที่บันทึกไว้เท่านั้น และจะแสดงนิสัยเมื่อพบสัญญาณซ้ำ",
        "habits": habits,
    }


def build_personalized_feed(all_openings, history, habit_profile):
    if not history:
        return []

    feed = []
    for habit in habit_profile["habits"]:
        opening = next(item for item in all_openings if item["id"] == habit["opening_id"])
        feed.append({
            **opening,
            "feed_tag": f"แนะนำจากนิสัย: {habit['title']}",
            "feed_reason": f"{habit['evidence']} เหมาะกับคลิปนี้เพื่อ{habit['recommendation']}",
            "tag_color": "danger" if habit["key"] == "time_pressure" else "primary",
        })

    if not feed:
        feed.append({
            **all_openings[2],
            "feed_tag": "แนะนำเพื่อพัฒนาต่อ",
            "feed_reason": "ยังไม่พบจุดอ่อนที่เกิดซ้ำชัดเจน จึงแนะนำการคุมโครงสร้างและวางแผนล่วงหน้า",
            "tag_color": "success",
        })
    return feed