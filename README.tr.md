# Jan - Açık kaynaklı ChatGPT alternatifi

<img width="2048" height="280" alt="Jan GitHub tanıtım görseli" src="https://github.com/user-attachments/assets/f3f87889-c133-433b-b250-236218150d3f" />

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh.md">中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <strong>Türkçe</strong>
</p>

<p align="center">
  <!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
  <img alt="GitHub commit activity" src="https://img.shields.io/github/commit-activity/m/janhq/jan"/>
  <img alt="Github Last Commit" src="https://img.shields.io/github/last-commit/janhq/jan"/>
  <img alt="Github Contributors" src="https://img.shields.io/github/contributors/janhq/jan"/>
  <img alt="GitHub closed issues" src="https://img.shields.io/github/issues-closed/janhq/jan"/>
  <img alt="Discord" src="https://img.shields.io/discord/1107178041848909847?label=discord"/>
</p>

<p align="center">
  <a href="https://jan.ai/docs/desktop">Başlarken</a>
  - <a href="https://discord.gg/Exe46xPMbK">Topluluk</a>
  - <a href="https://jan.ai/changelog">Değişiklik günlüğü</a>
  - <a href="https://github.com/janhq/jan/issues">Hata bildirme</a>
</p>

Jan, açık kaynaklı yapay zekânın en iyi olanaklarını kullanımı kolay bir uygulamada sunar. Büyük dil modellerini (LLM) **tam kontrol** ve **gizlilik** ile indirin ve çalıştırın.

## Kurulum

<p align="center">
  <table>
    <tr>
      <!-- Microsoft Store Badge -->
      <td align="center" valign="middle">
        <a href="https://apps.microsoft.com/detail/xpdcnfn5cpzlqb">
          <img height="60"
            width="200"
               alt="Microsoft Store'dan edinin"
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
               alt="Flathub'dan edinin"
               src="https://flathub.org/assets/badges/flathub-badge-en.svg"/>
        </a>
      </td>
    </tr>
  </table>
</p>

Başlamanın en kolay yolu, işletim sisteminize uygun sürümü indirmektir:

<table>
  <tr>
    <td><b>Platform</b></td>
    <td><b>İndir</b></td>
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
    <td><a href='https://github.com/janhq/jan/issues/4543#issuecomment-4142429792'>Kurulum adımları</a></td>
  </tr>
</table>

[jan.ai](https://jan.ai/) veya [GitHub sürümleri](https://github.com/janhq/jan/releases) üzerinden indirin.

## Özellikler

- **Yerel yapay zekâ modelleri**: HuggingFace üzerinden Llama, Gemma, Qwen, GPT-oss gibi büyük dil modellerini indirin ve çalıştırın.
- **Bulut entegrasyonu**: OpenAI üzerinden GPT modellerine, Anthropic üzerinden Claude modellerine; Mistral, Groq, MiniMax ve diğer sağlayıcılara bağlanın.
- **Özel asistanlar**: Görevlerinize özel yapay zekâ asistanları oluşturun.
- **OpenAI uyumlu API**: Diğer uygulamalar için `localhost:1337` adresinde yerel sunucu çalıştırın.
- **Model Context Protocol**: Ajan yetenekleri için MCP entegrasyonunu kullanın.
- **Önce gizlilik**: İstediğinizde her şey yerel olarak çalışır.

## Kaynak koddan derleme

Uygulamayı kendiniz derlemek isterseniz:

### Gereksinimler

- Node.js ≥ 20.0.0
- Yarn ≥ 4.5.3
- Make ≥ 3.81
- Rust (Tauri için)
- Yalnızca Apple Silicon macOS için MetalToolchain: `xcodebuild -downloadComponent MetalToolchain`

### Make ile çalıştırma

```bash
git clone https://github.com/janhq/jan
cd jan
make dev
```

Bu komut bağımlılıkları kurar, temel bileşenleri derler ve uygulamayı başlatır.

**Kullanılabilir Make hedefleri:**

- `make dev` — Geliştirme ortamını tamamen hazırlayıp uygulamayı başlatır.
- `make build` — Üretim derlemesi oluşturur.
- `make test` — Testleri ve kod denetimini çalıştırır.
- `make clean` — Oluşturulan dosyaları temizleyerek yeniden başlamanızı sağlar.

### Komutları elle çalıştırma

```bash
yarn install
yarn build
yarn dev
```

### Windows'ta derleme

`make dev` komutunu **Git Bash** içinde çalıştırın (Git for Windows ile kurulur). Make, tariflerini `sh` üzerinden çalıştırdığı için yalnızca `cmd.exe` kullanmak yeterli değildir.

“Native Tools Command Prompt for VS 2022” kullanmanız **gerekmez**. Pakete dahil llama.cpp motoru Ninja ve `clang-cl` ile derlenir; `clang-cl`, MSVC araç zincirini ve Windows SDK'sını kendisi bulur. Aşağıdakiler kurulu olmalıdır; `ninja`, `clang-cl` ve `cmake` ayrıca `PATH` üzerinde bulunmalıdır:

- Visual Studio 2022 Build Tools (MSVC x64 iş yükü ve Windows SDK)
- LLVM (`clang-cl` sağlar)
- Ninja
- CMake
- CUDA Toolkit — yalnızca `JAN_ENGINE_VARIANT=cuda12`/`cuda13` derlemeleri için

Motor varyantları `JAN_ENGINE_VARIANT` ile seçilir. `cpu`, `vulkan`, `metal`, `cuda12`, `cuda13`, `hip`/`rocm` değerleri `-` ile birleştirilebilir. Örneğin:

```bash
make dev JAN_ENGINE_VARIANT=cuda13
```

`tauri-plugin-llamacpp(build)` sırasında **“nvcc fatal : Could not open output file ...fattn-...cu.obj.d”** hatası, derleme yolunun Windows'un 260 karakterlik `MAX_PATH` sınırını aştığını gösterir. nvcc, uzun yol desteği ayarına uymaz. Derleme betiği artık bunu algılar ve llama.cpp derleme ağacını otomatik olarak `%LOCALAPPDATA%\jan-engine` altında kısa bir dizine taşır. Yine de yol uzunluğu hatası alırsanız `JAN_ENGINE_BUILD_DIR` değişkenini kısa bir yola (ör. `C:\jb`) ayarlayın veya depoyu sürücünün köküne daha yakın bir konuma taşıyın.

## Sistem gereksinimleri

**Rahat bir kullanım için asgari gereksinimler:**

- **macOS**: 13.6 ve üzeri (3B modeller için 8 GB RAM, 7B için 16 GB, 13B için 32 GB)
- **Windows**: NVIDIA/AMD/Intel Arc GPU desteğiyle Windows 10 ve üzeri
- **Linux**: Çoğu dağıtım çalışır; GPU hızlandırması kullanılabilir.

Ayrıntılı uyumluluk bilgileri için [kurulum kılavuzlarına](https://jan.ai/docs/desktop/mac) bakın.

## Sorun giderme

Sorun yaşarsanız:

1. [Sorun giderme belgelerimizi](https://jan.ai/docs/desktop/troubleshooting) inceleyin.
2. Hata günlüklerinizi ve sistem özelliklerinizi kopyalayın.
3. [Discord](https://discord.gg/FTk2MvZwJH) sunucumuzun `#🆘|jan-help` kanalından yardım isteyin.

## Katkıda bulunma

Katkılarınızı bekliyoruz. Ayrıntılı bilgi için [CONTRIBUTING.md](CONTRIBUTING.md) dosyasına bakın.

> **Not:** Katkılarınızı doğrulayabilmemiz için lütfen [commit'lerinizi imzalayın](CONTRIBUTING.md#signed-commits).

## Bağlantılar

- [Belgeler](https://jan.ai/docs) — Kullanım kılavuzu
- [API başvuru kılavuzu](https://jan.ai/api-reference) — Teknik ayrıntılar
- [Değişiklik günlüğü](https://jan.ai/changelog) — Değişiklikler ve düzeltmeler
- [Discord](https://discord.gg/FTk2MvZwJH) — Topluluğumuzun buluşma yeri

## İletişim

- **Hatalar**: [GitHub Issues](https://github.com/janhq/jan/issues)
- **İş birliği**: hello@jan.ai
- **İş başvuruları**: hr@jan.ai
- **Genel tartışmalar**: [Discord](https://discord.gg/FTk2MvZwJH)

## Lisans

Apache 2.0 — Paylaşmaya değer verdiğimiz için.

## Teşekkürler

Şu projelerin katkılarıyla geliştirildi:

- [Llama.cpp](https://github.com/ggerganov/llama.cpp)
- [Tauri](https://tauri.app/)
- [Scalar](https://github.com/scalar/scalar)
