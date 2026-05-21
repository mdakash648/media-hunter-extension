# 🎯 Media Hunter - Chrome Extension

## কীভাবে ইনস্টল করবেন

### ধাপ ১: ZIP খুলুন
- `media-hunter-extension.zip` ফাইলটি extract করুন
- একটি ফোল্ডার পাবেন: `media-hunter-extension`

### ধাপ ২: Chrome এ লোড করুন
1. Chrome ব্রাউজার খুলুন
2. Address bar এ লিখুন: `chrome://extensions`
3. উপরে ডান দিকে **"Developer mode"** ON করুন
4. **"Load unpacked"** বাটনে ক্লিক করুন
5. Extract করা `media-hunter-extension` ফোল্ডারটি select করুন
6. **"Select Folder"** ক্লিক করুন

### ধাপ ৩: ব্যবহার করুন
1. Toolbar এ 🎯 আইকনে ক্লিক করুন
2. **মিডিয়া** — যেকোনো পেজে media URL স্ক্যান
3. **FTP সার্চ** — FTP folder page এ গিয়ে movie নাম লিখে খুঁজুন
4. **FTP স্ক্যান** — সার্ভার লিস্ট থেকে working server খুঁজুন

---

## ফিচার সমূহ (v13 — তিনটি ট্যাব)

### 🎯 মিডিয়া হান্টার
- Current page থেকে MP4, MKV, MP3, M3U8 সহ সব media URL
- Copy, Download, VLC, ফিল্টার

### 🔍 FTP সার্চ
- FTP server এর **বর্তমান page** থেকে Movie/TV Series নাম দিয়ে খোঁজা
- Check Tab, লিংক কপি, নতুন ট্যাবে খোলা

### 🖥️ FTP সার্ভার স্ক্যান
- সার্ভার লিস্ট থেকে working/dead সার্ভার চেক (background এ চলে)
- সব Working লিংক একসাথে ভিজিট

---

## কী কী স্ক্যান করে?

- `<video>` ও `<audio>` ট্যাগের src
- `<source>` ট্যাগের URL
- সব `<a href>` লিংক
- data-src, data-url, data-video attributes
- Inline `<script>` এর মধ্যের URL
- পুরো HTML এর মধ্যে media URL

---

## সমস্যা হলে

- Extension reload করুন (chrome://extensions → Reload)
- পেজ refresh করে আবার স্ক্যান করুন
- কিছু sites CORS বা DRM protection ব্যবহার করে, সেক্ষেত্রে direct download কাজ না-ও করতে পারে
