"""pages/page1.py — AI Arena for chess analysis."""

TITLE = "สนามประลองและวิเคราะห์ AI (AI Arena)"


def build():
    features = [
        {
            "title": "เล่นจริงกับ Stockfish",
            "detail": "กระดานหมากรุกเล่นสดแบบเรียลไทม์ พร้อมปรับความยากได้ 8 ระดับ",
            "tag": "Live",
        },
        {
            "title": "Panic Meter",
            "detail": "ติดตามความเครียดและความตื่นตระหนกขณะเล่นเพื่อช่วยให้ตัดสินใจดีขึ้น",
            "tag": "AI",
        },
        {
            "title": "Replay + Blunder Mark",
            "detail": "ดูคลิปวิเคราะห์ผิดพลาดแบบสั้น ๆ พร้อมตำแหน่งสำคัญที่ทำให้พลาด",
            "tag": "Replay",
        },
        {
            "title": "AI Coach ภาษาไทย",
            "detail": "วิเคราะห์จุดอ่อนแบบ Tunnel Vision, King Safety และการคุมกลางกระดาน",
            "tag": "Coach",
        },
    ]

    stats = [
        {"label": "ความพร้อมใช้งาน", "value": "98%", "class": "good"},
        {"label": "โหมดฝึก", "value": "4", "class": "gold"},
        {"label": "AI Coach", "value": "พร้อม", "class": "good"},
    ]

    coach_steps = [
        "เปิดเกมใหม่และเลือกระดับความยาก",
        "ตรวจสอบ Panic Meter และความปลอดภัยของกษัตริย์",
        "ดู replay ช่วงผิดพลาดและจุดตัดสินใจที่ควรปรับ",
        "รับคำแนะนำจาก AI และฝึกซ้ำจนเข้าใจแนวทางที่ถูก",
    ]

    active_features = 0
    for feature in features:
        if feature["tag"] in ["Live", "AI", "Replay"]:
            active_features += 1

    system_ready = True if active_features >= 3 else False
    return {
        "system_ready": system_ready,
        "features": features,
        "stats": stats,
        "coach_steps": coach_steps,
    }
