<div dir="rtl">

# Jan - بديل مفتوح المصدر لـ ChatGPT

</div>

<img width="2048" height="280" alt="github jan banner" src="https://github.com/user-attachments/assets/f3f87889-c133-433b-b250-236218150d3f" />

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh.md">中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <strong>العربية</strong>
</p>

<p align="center">
  <!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
  <img alt="GitHub commit activity" src="https://img.shields.io/github/commit-activity/m/janhq/jan"/>
  <img alt="Github Last Commit" src="https://img.shields.io/github/last-commit/janhq/jan"/>
  <img alt="Github Contributors" src="https://img.shields.io/github/contributors/janhq/jan"/>
  <img alt="GitHub closed issues" src="https://img.shields.io/github/issues-closed/janhq/jan"/>
  <img alt="Discord" src="https://img.shields.io/discord/1107178041848909847?label=discord"/>
</p>

<div dir="rtl">

<p align="center">
  <a href="https://jan.ai/docs/desktop">البدء</a>
  - <a href="https://discord.gg/Exe46xPMbK">المجتمع</a>
  - <a href="https://jan.ai/changelog">سجل التغييرات</a>
  - <a href="https://github.com/janhq/jan/issues">الإبلاغ عن الأخطاء</a>
</p>

يقدّم Jan أفضل ما في الذكاء الاصطناعي مفتوح المصدر ضمن منتج سهل الاستخدام. نزّل نماذج اللغة الكبيرة (LLMs) وشغّلها مع **تحكّم كامل** و**خصوصية**.

## التثبيت

</div>

<p align="center">
  <table>
    <tr>
      <!-- Microsoft Store Badge -->
      <td align="center" valign="middle">
        <a href="https://apps.microsoft.com/detail/xpdcnfn5cpzlqb">
          <img height="60"
            width="200"
               alt="احصل عليه من Microsoft Store"
               src="https://get.microsoft.com/images/en-us%20dark.svg"/>
        </a>
      </td>
      <!-- Spacer -->
      <td width="20"></td>
      <!-- Flathub Official Badge -->
      <td align="center" valign="middle">
        <a href="https://flathub.org/apps/ai.jan.Jan">
          <img height="60"
            width="200"
               alt="احصل عليه من Flathub"
               src="https://flathub.org/assets/badges/flathub-badge-en.svg"/>
        </a>
      </td>
    </tr>
  </table>
</p>

<div dir="rtl">

أسهل طريقة للبدء هي تنزيل أحد الإصدارات التالية المناسبة لنظام التشغيل لديك:

<table>
  <tr>
    <td><b>المنصة</b></td>
    <td><b>التنزيل</b></td>
  </tr>
  <tr>
    <td><b>Windows</b></td>
    <td><a href='https://app.jan.ai/download/latest/win-x64'>jan.exe</a></td>
  </tr>
  <tr>
    <td><b>macOS</b></td>
    <td><a href='https://app.jan.ai/download/latest/mac-universal'>jan.dmg</a></td>
  </tr>
  <tr>
    <td><b>Linux (deb)</b></td>
    <td><a href='https://app.jan.ai/download/latest/linux-amd64-deb'>jan.deb</a></td>
  </tr>
  <tr>
    <td><b>Linux (AppImage)</b></td>
    <td><a href='https://app.jan.ai/download/latest/linux-amd64-appimage'>jan.AppImage</a></td>
  </tr>
  <tr>
    <td><b>Linux (Arm64)</b></td>
    <td><a href='https://github.com/janhq/jan/issues/4543#issuecomment-4142429792'>الشرح</a></td>
  </tr>
</table>


نزّله من [jan.ai](https://jan.ai/) أو من [إصدارات GitHub](https://github.com/janhq/jan/releases).

## الميزات

- **نماذج ذكاء اصطناعي محلية**: نزّل نماذج اللغة الكبيرة وشغّلها (Llama وGemma وQwen وGPT-oss وغيرها) من HuggingFace
- **التكامل مع السحابة**: اتصل بنماذج GPT عبر OpenAI، ونماذج Claude عبر Anthropic، وكذلك Mistral وGroq وMiniMax وغيرها
- **مساعدون مخصصون**: أنشئ مساعدين متخصصين بالذكاء الاصطناعي لمهامك
- **واجهة برمجية متوافقة مع OpenAI**: خادم محلي على `localhost:1337` تستخدمه التطبيقات الأخرى
- **بروتوكول سياق النموذج (Model Context Protocol)**: تكامل MCP لقدرات الوكلاء (agentic)
- **الخصوصية أولاً**: كل شيء يعمل محلياً متى أردت ذلك

## البناء من المصدر

لمن يحب الطريق الأطول والأمتع:

### المتطلبات الأساسية

- Node.js ≥ 20.0.0
- Yarn ≥ 4.5.3
- Make ≥ 3.81
- Rust (لـ Tauri)
- (لأجهزة macOS بمعالج Apple Silicon فقط) MetalToolchain `xcodebuild -downloadComponent MetalToolchain`

### التشغيل باستخدام Make

</div>

```bash
git clone https://github.com/janhq/jan
cd jan
make dev
```

<div dir="rtl">

يتولى هذا الأمر كل شيء: يثبّت الاعتماديات، ويبني المكوّنات الأساسية، ثم يشغّل التطبيق.

**أهداف make المتاحة:**
- `make dev` - إعداد بيئة التطوير كاملةً وتشغيل التطبيق
- `make build` - بناء نسخة الإنتاج
- `make test` - تشغيل الاختبارات وفحص الشيفرة (linting)
- `make clean` - حذف كل شيء والبدء من جديد

### الأوامر اليدوية

</div>

```bash
yarn install
yarn build
yarn dev
```

<div dir="rtl">

### البناء على Windows

شغّل `make dev` من **Git Bash** (يُثبَّت مع Git for Windows) — يمرّر make أوامر الوصفات (recipes) الخاصة به عبر `sh`، لذا لن يعمل `cmd.exe` العادي.

أنت **لا** تحتاج إلى "Native Tools Command Prompt for VS 2022". فمحرك llama.cpp المضمَّن يُبنى باستخدام Ninja مع `clang-cl`، ويعثر `clang-cl` بنفسه على سلسلة أدوات MSVC وعلى Windows SDK. أما ما يجب تثبيته (وإتاحته في `PATH` للأدوات `ninja` و`clang-cl` و`cmake`) فهو:

- Visual Studio 2022 Build Tools (workload الخاص بـ MSVC x64 مع Windows SDK)
- LLVM (يوفّر `clang-cl`)
- Ninja
- CMake
- CUDA Toolkit — فقط لعمليات البناء التي تستخدم `JAN_ENGINE_VARIANT=cuda12`/`cuda13`

تُحدَّد متغيرات المحرك (engine variants) عبر `JAN_ENGINE_VARIANT` (القيم: `cpu` و`vulkan` و`metal` و`cuda12` و`cuda13` و`hip`/`rocm`، وتُوصَل بينها بالرمز `-`)، مثال:

</div>

```bash
make dev JAN_ENGINE_VARIANT=cuda13
```

<div dir="rtl">

ظهور الخطأ **"nvcc fatal : Could not open output file ...fattn-...cu.obj.d"** أثناء `tauri-plugin-llamacpp(build)` يعني أن مسار البناء تجاوز حد `MAX_PATH` في Windows البالغ 260 حرفاً — فـ nvcc لا يلتزم بخيار تفعيل المسارات الطويلة. يكتشف سكربت البناء هذه الحالة الآن وينقل شجرة بناء llama.cpp تلقائياً إلى مجلد قصير المسار ضمن `%LOCALAPPDATA%\jan-engine`. وإن واجهتَ أخطاء طول المسار رغم ذلك، فاضبط `JAN_ENGINE_BUILD_DIR` على مسار قصير (مثل `C:\jb`) أو انقل نسخة المستودع إلى موضع أقرب إلى جذر القرص.

## متطلبات النظام

**الحد الأدنى من المواصفات لتجربة جيدة:**

- **macOS**: الإصدار 13.6 أو أحدث (ذاكرة RAM بسعة 8GB للنماذج بحجم 3B، و16GB لنماذج 7B، و32GB لنماذج 13B)
- **Windows**: الإصدار 10 أو أحدث، مع دعم وحدات GPU من NVIDIA وAMD وIntel Arc
- **Linux**: تعمل معظم التوزيعات، والتسريع عبر وحدة GPU متاح

لمعرفة تفاصيل التوافق، راجع [أدلة التثبيت](https://jan.ai/docs/desktop/mac).

## استكشاف الأخطاء وإصلاحها

إذا لم تسر الأمور كما ينبغي:

1. راجع [وثائق استكشاف الأخطاء وإصلاحها](https://jan.ai/docs/desktop/troubleshooting)
2. انسخ سجلات الأخطاء ومواصفات نظامك
3. اطلب المساعدة في قناة `#🆘|jan-help` على [Discord](https://discord.gg/FTk2MvZwJH)


## المساهمة

المساهمات مرحَّب بها. راجع [CONTRIBUTING.md](CONTRIBUTING.md) للاطلاع على التفاصيل كاملة.

> **ملاحظة:** يُرجى [توقيع الـ commits](CONTRIBUTING.md#signed-commits) الخاصة بك لنتمكن من التحقق من مساهماتك.

## روابط

- [التوثيق](https://jan.ai/docs) - الدليل الذي ينبغي أن تقرأه
- [مرجع واجهة البرمجة (API)](https://jan.ai/api-reference) - لمن يهوى التفاصيل التقنية
- [سجل التغييرات](https://jan.ai/changelog) - ما أفسدناه وما أصلحناه
- [Discord](https://discord.gg/FTk2MvZwJH) - حيث يجتمع المجتمع

## التواصل

- **الأخطاء**: [GitHub Issues](https://github.com/janhq/jan/issues)
- **الأعمال**: hello@jan.ai
- **الوظائف**: hr@jan.ai
- **النقاش العام**: [Discord](https://discord.gg/FTk2MvZwJH)

## الترخيص

Apache 2.0 - لأن المشاركة دليل اهتمام.

## شكر وتقدير

بُني على أكتاف العمالقة:

- [Llama.cpp](https://github.com/ggerganov/llama.cpp)
- [Tauri](https://tauri.app/)
- [Scalar](https://github.com/scalar/scalar)

</div>

ترجمة: فريق مُشَيِّد
