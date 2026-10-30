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
| `src/clip.ts` | อัดคลิป 1280×720 + วง + แถบข้อความ ด้วย MediaRecorder (mp4 ถ้ารองรับ ไม่งั้น webm) |
| `src/attachments.ts` | รูปประกอบไม่บังคับ (Runsheet / ท้ายรถ / Seal) ใส่ ZIP เป็นไฟล์ต้นฉบับ |
| `src/files.ts` | ZIP (JSZip), ดาวน์โหลด |
| `src/time.ts` | แปลงเวลา HH:MM:SS |
| `src/storage.ts` | เก็บค่าฟอร์มใน localStorage (ไม่เก็บคลิป/ภาพ) |

## เฟส 2 (ยังไม่ทำ)

- OCR เวลามุมจอ: อ่านจากพื้นที่กรอบเหลือง (`Annotator.shapes` type `rect`) ด้วย tesseract.js → `normalizeTime()` → ใช้ `VideoController.seek()` ไล่หาเฟรม
- Google Drive: รับ `OutFile[]` ชุดเดียวกับที่ใช้ทำ ZIP แล้วอัปโหลดแยกโฟลเดอร์ตาม path
- HEVC fallback: ใน `VideoController.load()` ตอน reject `HEVC_MSG` ให้แปลงด้วย ffmpeg.wasm แล้วโหลด blob ใหม่
