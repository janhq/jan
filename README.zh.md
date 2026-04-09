# Jan - Açık kaynaklı ChatGPT alternatifi

<img width="2048" height="280" alt="github jan banner" src="https://github.com/user-attachments/assets/f3f87889-c133-433b-b250-236218150d3f" />

<p align="center">
  <a href="README.md">English</a> ·
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
  <a href="https://jan.ai/docs/desktop">Hızlı Başlangıç</a>
  - <a href="https://discord.gg/Exe46xPMbK">Topluluk</a>
  - <a href="https://jan.ai/changelog">Sürüm Notları</a>
  - <a href="https://github.com/janhq/jan/issues">Hata Bildirimi</a>
</p>

Jan, açık kaynak yapay zekanın en iyi yönlerini kullanımı kolay bir ürünle sunar. Büyük dil modellerini indirip çalıştırın; **tam denetim** ve **gizlilik** sizde olsun.

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
               alt="Flathub üzerinden edinin"
               src="https://flathub.org/assets/badges/flathub-badge-en.svg"/>
        </a>
      </td>
    </tr>
  </table>
</p>

Başlamanın en kolay yolu, işletim sisteminize uygun aşağıdaki sürümlerden birini indirmektir:

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
    <td><a href='https://github.com/janhq/jan/issues/4543#issuecomment-3734911349'>Kurulum Rehberi</a></td>
  </tr>
</table>


İndirmeyi [jan.ai](https://jan.ai/) veya [GitHub Releases](https://github.com/janhq/jan/releases) üzerinden yapabilirsiniz.

## Özellikler

- **Yerel AI Modelleri**: HuggingFace üzerinden LLM indirip çalıştırın (Llama, Gemma, Qwen, GPT-oss vb.)
- **Bulut Entegrasyonu**: OpenAI ile GPT modellerine, Anthropic ile Claude modellerine; ayrıca Mistral, Groq, MiniMax ve diğer servislere bağlanın
- **Özel Asistanlar**: Görevlerinize özel AI asistanları oluşturun
- **OpenAI Uyumlu API**: Diğer uygulamalar için `localhost:1337` üzerinde yerel sunucu
- **Model Context Protocol**: Aracı yetenekleri için MCP entegrasyonu
- **Önce Gizlilik**: İstediğinizde her şeyi yerelde çalıştırın

## Kaynaktan Derleme

Bu bölüm, işi sıfırdan kurmak isteyenler içindir.

### Gereksinimler

- Node.js ≥ 20.0.0
- Yarn ≥ 4.5.3
- Make ≥ 3.81
- Rust (Tauri derlemesi için)
- (Yalnızca macOS Apple Silicon) MetalToolchain: `xcodebuild -downloadComponent MetalToolchain`

### Make ile Çalıştırma

```bash
git clone https://github.com/janhq/jan
cd jan
make dev
```

Bu komut tüm adımları halleder: bağımlılıkları kurar, temel bileşenleri derler ve uygulamayı başlatır.

**Kullanılabilir make hedefleri:**
- `make dev` - Tam geliştirme kurulumu ve çalıştırma
- `make build` - Üretim derlemesi
- `make test` - Testleri ve lint kontrollerini çalıştırma
- `make clean` - Üretilen her şeyi temizleme ve sıfırlama

### El ile Komutlar

```bash
yarn install
yarn build
yarn dev
```

## Sistem Gereksinimleri

**Makul bir deneyim için önerilen en düşük seviye:**

- **macOS**: 13.6+ (3B modeller için 8 GB RAM, 7B için 16 GB, 13B için 32 GB)
- **Windows**: 10+ ve NVIDIA/AMD/Intel Arc GPU desteği
- **Linux**: Çoğu dağıtım çalışır, GPU hızlandırma kullanılabilir

Detaylı uyumluluk bilgileri için [kurulum rehberlerine](https://jan.ai/docs/desktop/mac) bakın.

## Sorun Giderme

Bir şeyler ters giderse:

1. [Sorun giderme belgelerine](https://jan.ai/docs/desktop/troubleshooting) bakın
2. Hata günlüklerinizi ve sistem özelliklerinizi kopyalayın
3. Discord üzerindeki `#🆘|jan-help` kanalında yardım isteyin: [Discord](https://discord.gg/FTk2MvZwJH)


## Katkı

Katkılar memnuniyetle karşılanır. Tüm ayrıntılar için [CONTRIBUTING.md](CONTRIBUTING.md) dosyasına bakın.

## Bağlantılar

- [Dokümantasyon](https://jan.ai/docs) - Önce okunması gereken kullanım kılavuzu
- [API Referansı](https://jan.ai/api-reference) - Teknik kullanıcılar için
- [Sürüm Notları](https://jan.ai/changelog) - Değişen ve düzeltilenler
- [Discord](https://discord.gg/FTk2MvZwJH) - Topluluğun buluşma noktası

## İletişim

- **Hatalar**: [GitHub Issues](https://github.com/janhq/jan/issues)
- **İş Birliği**: hello@jan.ai
- **İş İlanları**: hr@jan.ai
- **Genel Tartışma**: [Discord](https://discord.gg/FTk2MvZwJH)

## Lisans

Apache 2.0 - Paylaşım iyidir.

## Teşekkürler

Bu proje şu güçlü araçların üzerine kurulu:

- [Llama.cpp](https://github.com/ggerganov/llama.cpp)
- [Tauri](https://tauri.app/)
- [Scalar](https://github.com/scalar/scalar)
