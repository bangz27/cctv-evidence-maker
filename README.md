# CCTV Evidence Maker

เครื่องมือทำภาพหลักฐาน "ยิงขึ้นรถ Shuttle แล้ว" (FMHub_LHTransported) ทำงานในเบราว์เซอร์ทั้งหมด ไม่มี backend ไม่อัปโหลดคลิป

- เปิดใช้: https://bangz27.github.io/cctv-evidence-maker/
- **คู่มือการใช้งาน: [MANUAL.md](MANUAL.md)**

## ใช้งาน

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # ได้ไฟล์ static ใน dist/ (base: './' วางบน GitHub Pages ได้)
```

1. ลากคลิป .mp4 มาวาง → หาเฟรมด้วย scrubber / ปุ่ม ±1 เฟรม ±1s (คีย์ ← → , Shift+← →, Space) → "ใช้เฟรมนี้"
2. ปรับวงรีแดง / กรอบเหลือง (กรอบเหลืองครอบเวลามุมจอ ไม่ทับเวลา)
3. กรอก TO, เวลา LHPacking, เวลา CCTV ที่อ่านจากจอ, ปลายทาง, เลขพัสดุ (บรรทัดละเลข)
4. เลือกเลขพัสดุ → Ctrl+V วางภาพ FMS → คลิกบรรทัด LHPacking เพื่อกำหนดจุดลูกศร
5. สร้าง JPG / อัดคลิป / ดาวน์โหลด ZIP (`{เลข}/{เลข}_Evidence.jpg`, `{เลข}/CCTV_{เลข}.mp4`)

## โครงสร้าง

| ไฟล์ | หน้าที่ |
|---|---|
| `src/video.ts` | โหลดคลิปด้วย object URL, วัด fps, seek / step เฟรม, จับภาพเฟรม |
| `src/annotate.ts` | วงรี/กรอบ (พิกัดเป็นพิกเซลของวิดีโอ), editor ลาก-ย้าย-ย่อขยาย-undo |
| `src/evidence.ts` | วาดภาพหลักฐาน 2160×855 → JPG 0.92 |
| `src/fastclip.ts` | สร้างคลิปเร็ว: demux MP4 (mp4box) → WebCodecs ถอด/เข้ารหัส → mux MP4 (mp4-muxer) · ไม่ต้องเล่นคลิป สลับแท็บได้ |
| `src/clip.ts` | วาดเฟรมคลิป 1280×720 + วง + แถบข้อความ · fallback อัดแบบเวลาจริงด้วย MediaRecorder สำหรับไฟล์ที่ไม่ใช่ MP4 |
| `src/ocr.ts` | อ่านนาฬิกามุมจอในกรอบเหลืองด้วย tesseract.js (โหลดเมื่อใช้ครั้งแรก) · การหาเฟรมตามเวลาอยู่ใน `main.ts` |
| `src/attachments.ts` | รูปหลักฐาน LT (Runsheet / ท้ายรถ / Seal) ตั้งชื่อตามเลข LT ใส่ ZIP เป็นไฟล์ต้นฉบับ |
| `src/files.ts` | ZIP (JSZip), ดาวน์โหลด |
| `src/time.ts` | แปลงเวลา HH:MM:SS |
| `src/storage.ts` | เก็บค่าฟอร์มใน localStorage (ไม่เก็บคลิป/ภาพ) |
| `src/stats.ts` | นับยอดใช้งานแบบไม่ระบุตัวตน (GoatCounter `bangz`) · ไม่นับตอน `npm run dev` |

## เฟส 2 (ยังไม่ทำ)

- Google Drive: รับ `OutFile[]` ชุดเดียวกับที่ใช้ทำ ZIP แล้วอัปโหลดแยกโฟลเดอร์ตาม path
- HEVC fallback: ใน `VideoController.load()` ตอน reject `HEVC_MSG` ให้แปลงด้วย ffmpeg.wasm แล้วโหลด blob ใหม่
