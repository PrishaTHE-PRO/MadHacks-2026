# Fictional fishy invoice for the DealDig demo chat (sublet scam).
# Its EXIF says it was saved by Photoshop: the tell DealDig's edit check finds.
import sys
from PIL import Image, ImageDraw, ImageFont
out = sys.argv[1]
W, H = 720, 1000
img = Image.new("RGB", (W, H), "white")
d = ImageDraw.Draw(img)
F = lambda size, idx=0: ImageFont.truetype("/System/Library/Fonts/HelveticaNeue.ttc", size, index=idx)
d.rectangle([0, 0, W, 150], fill="#123c69")
d.text((40, 36), "Campus Sublet Housing LLC", font=F(36, 1), fill="white")
d.text((40, 90), "Official Reservation Invoice", font=F(26), fill="#c9d6e8")
d.text((40, 190), "INVOICE #CSH-20419", font=F(28, 1), fill="#123c69")
d.text((40, 232), "Issued: Nov 15, 2026", font=F(24), fill="#5b6070")
d.text((40, 290), "Room 2, 3BR sublet near campus", font=F(28), fill="#1f2330")
d.text((40, 330), "Spring semester · Landlord: Jordan Reyes", font=F(24), fill="#5b6070")
rows = [("Holding deposit (non-refundable)", "$300.00"), ("Key transfer fee", "$45.00"), ("Processing", "$15.00")]
y = 400
d.line([40, y - 14, W - 40, y - 14], fill="#e3e5ea", width=2)
for label, amt in rows:
    d.text((40, y), label, font=F(26), fill="#1f2330"); d.text((W - 160, y), amt, font=F(26), fill="#1f2330"); y += 52
d.line([40, y, W - 40, y], fill="#e3e5ea", width=2)
d.text((40, y + 20), "TOTAL DUE", font=F(30, 1), fill="#1f2330"); d.text((W - 190, y + 20), "$360.00", font=F(30, 1), fill="#1f2330")
y += 100
d.rounded_rectangle([40, y, W - 40, y + 190], radius=16, fill="#fff1f0", outline="#f2b8b5", width=2)
d.text((64, y + 22), "PAY BY ZELLE ONLY to 608-555-0147", font=F(27, 1), fill="#8e2a1a")
d.text((64, y + 70), "Due TODAY by 11:59 PM or the room", font=F(26), fill="#8e2a1a")
d.text((64, y + 108), "goes to the next applicant.", font=F(26), fill="#8e2a1a")
d.text((64, y + 146), "No viewings before payment.", font=F(26), fill="#8e2a1a")
d.text((40, H - 70), "Payments are final. Keys mailed after payment clears.", font=F(20), fill="#8a8f9c")
exif = Image.Exif()
exif[0x0131] = "Adobe Photoshop 25.1 (Macintosh)"   # Software
exif[0x0132] = "2026:11:15 01:12:40"                 # DateTime (modified)
img.save(out, "JPEG", quality=82, exif=exif.tobytes())
print("wrote", out)
