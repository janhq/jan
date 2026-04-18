# Jan - オープンソースのChatGPT代替アプリ

<img width="2048" height="280" alt="github jan banner" src="https://github.com/user-attachments/assets/f3f87889-c133-433b-b250-236218150d3f" />

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh.md">中文</a> ·
  <strong>日本語</strong>
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
  <a href="https://jan.ai/docs/desktop">はじめに</a>
  - <a href="https://discord.gg/Exe46xPMbK">コミュニティ</a>
  - <a href="https://jan.ai/changelog">変更履歴</a>
  - <a href="https://github.com/janhq/jan/issues">バグ報告</a>
</p>

Janはオープンソースの優れたAIを使いやすい製品として提供します。LLMをダウンロードして、**完全なコントロール**と**プライバシー**を保ちながら実行できます。

## インストール

<p align="center">
  <table>
    <tr>
      <!-- Microsoft Store Badge -->
      <td align="center" valign="middle">
        <a href="https://apps.microsoft.com/detail/xpdcnfn5cpzlqb">
          <img height="60"
            width="200"
               alt="Microsoft Storeで入手"
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
               alt="Flathubで入手"
               src="https://flathub.org/assets/badges/flathub-badge-en.svg"/>
        </a>
      </td>
    </tr>
  </table>
</p>

お使いのOSに対応したバージョンをダウンロードするのが最も簡単な方法です：

<table>
  <tr>
    <td><b>プラットフォーム</b></td>
    <td><b>ダウンロード</b></td>
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
    <td><a href='https://github.com/janhq/jan/issues/4543#issuecomment-4142429792'>手順</a></td>
  </tr>
</table>

[jan.ai](https://jan.ai/) または [GitHubリリース](https://github.com/janhq/jan/releases)からダウンロードできます。

## 機能

- **ローカルAIモデル**: HuggingFaceからLLM（Llama、Gemma、Qwen、GPT-ossなど）をダウンロードして実行
- **クラウド連携**: OpenAI経由のGPTモデル、Anthropic経由のClaudeモデル、Mistral、Groq、MiniMaxなどに接続
- **カスタムアシスタント**: タスクに特化したAIアシスタントを作成
- **OpenAI互換API**: 他のアプリケーション向けに`localhost:1337`でローカルサーバーを提供
- **Model Context Protocol**: エージェント機能のためのMCP統合
- **プライバシー最優先**: 必要に応じてすべてをローカルで実行

## ソースからビルド

自分で構築したい方向け：

### 前提条件

- Node.js ≥ 20.0.0
- Yarn ≥ 4.5.3
- Make ≥ 3.81
- Rust（Tauri用）
- （macOS Apple Siliconのみ）MetalToolchain `xcodebuild -downloadComponent MetalToolchain`

### Makeで実行

```bash
git clone https://github.com/janhq/jan
cd jan
make dev
```

これですべてが処理されます：依存関係のインストール、コアコンポーネントのビルド、アプリの起動が行われます。

**利用可能なmakeターゲット：**
- `make dev` - 開発環境のフルセットアップと起動
- `make build` - プロダクションビルド
- `make test` - テストとリンティングの実行
- `make clean` - すべて削除してクリーンな状態から開始

### 手動コマンド

```bash
yarn install
yarn build
yarn dev
```

## システム要件

**快適に使用するための最低スペック：**

- **macOS**: 13.6以上（3Bモデルに8GB RAM、7Bに16GB、13Bに32GB）
- **Windows**: 10以上、NVIDIA/AMD/Intel ArcのGPUサポート
- **Linux**: ほとんどのディストリビューションで動作、GPUアクセラレーション対応

詳細な互換性については[インストールガイド](https://jan.ai/docs/desktop/mac)をご確認ください。

## トラブルシューティング

問題が発生した場合：

1. [トラブルシューティングドキュメント](https://jan.ai/docs/desktop/troubleshooting)を確認
2. エラーログとシステムスペックをコピー
3. [Discord](https://discord.gg/FTk2MvZwJH)の`#🆘|jan-help`チャンネルでヘルプを依頼

## コントリビューション

コントリビューションを歓迎します。詳細は[CONTRIBUTING.md](CONTRIBUTING.md)をご覧ください。

## リンク

- [ドキュメント](https://jan.ai/docs) - ぜひ読んでいただきたいマニュアル
- [APIリファレンス](https://jan.ai/api-reference) - 技術的な詳細
- [変更履歴](https://jan.ai/changelog) - 修正と変更の記録
- [Discord](https://discord.gg/FTk2MvZwJH) - コミュニティの拠点

## お問い合わせ

- **バグ**: [GitHub Issues](https://github.com/janhq/jan/issues)
- **ビジネス**: hello@jan.ai
- **採用**: hr@jan.ai
- **一般的な議論**: [Discord](https://discord.gg/FTk2MvZwJH)

## ライセンス

Apache 2.0

## 謝辞

以下のプロジェクトの上に構築されています：

- [Llama.cpp](https://github.com/ggerganov/llama.cpp)
- [Tauri](https://tauri.app/)
- [Scalar](https://github.com/scalar/scalar)
