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

    # 2. ⚡ YouTube Recommendation Engine: อ่านประวัติการเล่นจริงจาก data.json
    raw_history = load()
    personalized_feed = []

    if len(raw_history) > 0:
        # ✅ วนลูปย้อนกลับจาก "เกมล่าสุด" (reversed) เพื่อหาเกมที่แพ้ หรือเกมที่มี Blunder
        target_game = None
        for game in reversed(raw_history):
            # ตรวจสอบว่าผู้เล่นเป็นฝ่ายแพ้หรือไม่ (หรือมี blunder >= 1)
            is_player_white = "คุณ" in str(game.get("white", ""))
            is_player_black = "คุณ" in str(game.get("black", ""))
            result = str(game.get("result", ""))

            player_lost = (is_player_white and result == "0-1") or (is_player_black and result == "1-0")
            has_blunders = game.get("blunders", 0) >= 1

            if player_lost or has_blunders or game.get("accuracy", 100) < 75.0:
                target_game = game
                break

        # ถ้าไม่เจอเกมที่แพ้เลย ให้หยิบเกมล่าสุดมาวิเคราะห์พัฒนาต่อยอด
        if not target_game:
            target_game = raw_history[-1]

        # ค้นหาว่ารูปเปิดของเกมเป้าหมายตรงกับคลิปไหนในคลัง
        matched = next((op for op in all_openings if op["eco"] == target_game.get("eco")), all_openings[0])

        # ปรับข้อความแท็กให้สอดคล้องกับผลการแข่งขันจริง
        result = str(target_game.get("result", ""))
        is_player_white = "คุณ" in str(target_game.get("white", ""))
        player_won = (is_player_white and result == "1-0") or (not is_player_white and result == "0-1")

        if player_won:
            feed_tag = "⭐ ต่อยอดชัยชนะในรูปเปิดนี้ (Mastery)"
            tag_color = "success"
        else:
            feed_tag = "🎯 แนะนำเพื่อแก้มือ (Revenge Match)"
            tag_color = "danger"

        # A. การ์ดแนะนำอันดับ 1: อิงจากเกมล่าสุดที่คัดกรองมา
        personalized_feed.append({
            **matched,
            "feed_tag": feed_tag,
            "feed_reason": f"วิเคราะห์จากเกมล่าสุด (วันที่ {target_game.get('date', '2026-09-24')}) รูป {matched['name']} มีจังหวะผิดพลาด {target_game.get('blunders', 0)} Blunders (ความแม่นยำ {target_game.get('accuracy', 75)}%)",
            "tag_color": tag_color
        })

        # B. การ์ดแนะนำอันดับ 2: อิงจากจิตวิทยาและการคิดเชิงระบบ (Systems Thinking)
        personalized_feed.append({
            **all_openings[2],
            "feed_tag": "🧠 แนะนำเพื่อปรับวิธีคิดเชิงระบบ (Prophylaxis)",
            "feed_reason": "วิดีโอฝึกการวางหมากป้องกันล่วงหน้า ช่วยแก้จุดอ่อนจากการผลักเบี้ยดับเพลิงเฉพาะหน้า (Tunnel Vision)",
            "tag_color": "primary"
        })
    else:
        # กรณีเพิ่งเริ่มเล่น ยังไม่มีประวัติ: ขึ้นคลิปยอดนิยมเป็นพื้นฐาน
        personalized_feed.append({
            **all_openings[0],
            "feed_tag": "🔥 คลิปยอดนิยมสำหรับเริ่มต้น",
            "feed_reason": "เรียนรู้รูปแบบ Italian Game เพื่อวางรากฐานการพัฒนาตัวหมากที่ดีที่สุด",
            "tag_color": "primary"
        })

    # หมวดหมู่สำหรับ Filter Chips
    categories = ["ทั้งหมด", "⚡ แนะนำสำหรับคุณ", "สายบุกเร็ว", "สายตั้งรับเชิงรุก", "สายคุมโครงสร้าง"]

    # ✅ คืนค่า dict โดยไม่มี "title" ซ้ำ (ป้องกัน TypeError)
    return {
        "all_openings": all_openings,
        "personalized_feed": personalized_feed,
        "categories": categories,
        "total_openings": len(all_openings)
    }