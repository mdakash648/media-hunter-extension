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
1. যেকোনো ওয়েবপেজে যান
2. Toolbar এ 🎯 আইকনে ক্লিক করুন
3. **⚡ স্ক্যান** বাটনে ক্লিক করুন
4. পাওয়া সব media URL দেখুন

---

## ফিচার সমূহ

- ✅ **MP4, MKV, AVI, MOV, WebM** - সব ভিডিও ফরম্যাট
- ✅ **MP3, AAC, OGG, WAV, FLAC** - সব অডিও ফরম্যাট
- ✅ **M3U8 (HLS streams)** সাপোর্ট
- ✅ **Copy বাটন** - URL ক্লিপবোর্ডে কপি
- ✅ **Download বাটন** - নতুন ট্যাবে খুলে ডাউনলোড
- ✅ **সব URL একসাথে কপি** করার অপশন
- ✅ Video / Audio / Other ফিল্টার
- ✅ বাংলা ইন্টারফেস

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
