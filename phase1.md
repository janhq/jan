# PHASE 1: Temel Altyapı ve API Yapılandırması

## 🎯 Amaç
Bu phase'de Jan uygulamasına çoklu API desteği, token/maliyet takibi ve context yönetimi eklenecek. Performans kritik öneme sahiptir.

## 📋 Özellikler
1. ✅ Multi-API Support (OpenAI Compatible API'ler)
2. ✅ API Monitoring Altyapısı
3. ✅ Token/Süre/Maliyet Tracking
4. ✅ Context Yönetimi ve Auto-Summarization
5. ✅ Model Seçimi (API bazlı)

---

## 🏗️ Mimari Değişiklikler

### 1. Multi-API Support Yapısı

#### Yeni Tip Tanımları
**Dosya:** `core/src/types/api/apiProvider.ts` (YENİ)
```typescript
export type APIProvider = {
  id: string
  name: string
  type: 'openai-compatible' | 'anthropic' | 'ollama' | 'lmstudio' | 'custom'
  baseUrl: string
  apiKey?: string
  models: APIModelInfo[]
  enabled: boolean
  metadata?: {
    icon?: string
    description?: string
    supportedFeatures?: string[]
  }
}

export type APIModelInfo = {
  id: string
  name: string
  displayName: string
  contextWindow: number
  maxTokens: number
  pricing?: {
    inputTokenPrice: number  // per 1M tokens
    outputTokenPrice: number // per 1M tokens
  }
  capabilities: {
    chat: boolean
    completion: boolean
    streaming: boolean
    functionCalling: boolean
    vision: boolean
  }
}

export type APIRequest = {
  id: string
  providerId: string
  modelId: string
  timestamp: number
  duration?: number
  tokenUsage?: {
    input: number
    output: number
    total: number
  }
  cost?: number
  error?: string
}
```

#### Core Extension
**Dosya:** `core/src/browser/extensions/api-manager.ts` (YENİ)
```typescript
import { BaseExtension, ExtensionTypeEnum } from '../extension'
import { APIProvider, APIModelInfo, APIRequest } from '../../types/api/apiProvider'

export abstract class APIManagerExtension extends BaseExtension {
  type(): ExtensionTypeEnum | undefined {
    return ExtensionTypeEnum.APIManager
  }

  // Provider Management
  abstract addProvider(provider: APIProvider): Promise<void>
  abstract removeProvider(providerId: string): Promise<void>
  abstract updateProvider(providerId: string, updates: Partial<APIProvider>): Promise<void>
  abstract listProviders(): Promise<APIProvider[]>
  abstract getProvider(providerId: string): Promise<APIProvider | null>

  // Model Discovery
  abstract fetchModelsFromProvider(providerId: string): Promise<APIModelInfo[]>
  abstract refreshAllModels(): Promise<void>

  // Request Tracking
  abstract logRequest(request: APIRequest): Promise<void>
  abstract getRequestHistory(filters?: {
    providerId?: string
    modelId?: string
    startDate?: number
    endDate?: number
  }): Promise<APIRequest[]>

  // Cost Calculation
  abstract calculateCost(providerId: string, modelId: string, inputTokens: number, outputTokens: number): number
}
```

**Implementasyon:** `extensions/api-manager-extension/src/index.ts` (YENİ EXTENSION)

---

### 2. Token/Maliyet Tracking Sistemi

#### Storage Schema
**Dosya:** `core/src/types/tracking/usage.ts` (YENİ)
```typescript
export type UsageSession = {
  id: string
  threadId: string
  startTime: number
  endTime?: number
  requests: APIRequest[]
  totalTokens: {
    input: number
    output: number
    total: number
  }
  totalCost: number
  averageResponseTime: number
}

export type UsageStatistics = {
  daily: {
    date: string
    totalRequests: number
    totalTokens: number
    totalCost: number
    byProvider: Record<string, {
      requests: number
      tokens: number
      cost: number
    }>
  }[]
  monthly: {
    month: string
    totalRequests: number
    totalTokens: number
    totalCost: number
  }[]
  lifetime: {
    totalRequests: number
    totalTokens: number
    totalCost: number
    mostUsedProvider: string
    mostUsedModel: string
  }
}
```

#### Usage Tracker Service
**Dosya:** `web-app/src/services/usage/index.ts` (YENİ)
```typescript
import { APIRequest, UsageSession, UsageStatistics } from '@janhq/core'

class UsageTracker {
  private currentSession: UsageSession | null = null

  startSession(threadId: string): UsageSession
  endSession(sessionId: string): void
  logRequest(sessionId: string, request: APIRequest): void

  // Statistics
  getSessionStats(sessionId: string): UsageSession
  getDailyStats(date?: string): UsageStatistics['daily'][0]
  getMonthlyStats(month?: string): UsageStatistics['monthly'][0]
  getLifetimeStats(): UsageStatistics['lifetime']

  // Export
  exportStats(format: 'json' | 'csv', dateRange?: { start: number, end: number }): Promise<Blob>
}

export const usageTracker = new UsageTracker()
```

**State Management:** `web-app/src/hooks/useUsageTracking.ts` (YENİ)

---

### 3. Context Yönetimi ve Auto-Summarization

#### Context Manager
**Dosya:** `core/src/browser/extensions/context-manager.ts` (YENİ)
```typescript
import { BaseExtension, ExtensionTypeEnum } from '../extension'
import { Thread, Message } from '../../types'

export type ContextSummary = {
  id: string
  threadId: string
  messages: Message[]
  summary: string
  timestamp: number
  tokenCount: number
}

export abstract class ContextManagerExtension extends BaseExtension {
  type(): ExtensionTypeEnum | undefined {
    return ExtensionTypeEnum.ContextManager
  }

  // Context Analysis
  abstract analyzeContextUsage(thread: Thread): Promise<{
    currentTokens: number
    maxTokens: number
    utilizationPercentage: number
    shouldSummarize: boolean
  }>

  // Summarization
  abstract summarizeMessages(messages: Message[], targetTokenCount: number): Promise<ContextSummary>
  abstract applySummary(threadId: string, summary: ContextSummary): Promise<void>

  // Context Trimming
  abstract trimContext(thread: Thread, targetTokenCount: number): Promise<Message[]>

  // Summary Management
  abstract getSummaries(threadId: string): Promise<ContextSummary[]>
  abstract deleteSummary(summaryId: string): Promise<void>
}
```

#### Auto-Summarization Logic
**Dosya:** `extensions/context-manager-extension/src/auto-summarizer.ts` (YENİ)
```typescript
export class AutoSummarizer {
  private readonly TRIGGER_THRESHOLD = 0.85 // Context 85% dolduğunda özetle
  private readonly TARGET_REDUCTION = 0.50  // %50'ye düşür

  async checkAndSummarize(thread: Thread): Promise<boolean> {
    const analysis = await this.analyzeContext(thread)

    if (analysis.utilizationPercentage >= this.TRIGGER_THRESHOLD) {
      await this.performSummarization(thread, analysis)
      return true
    }

    return false
  }

  private async performSummarization(thread: Thread, analysis: ContextAnalysis): Promise<void> {
    // 1. Eski mesajları seç (en son N mesaj hariç)
    // 2. Özetleme için API'ye gönder
    // 3. Özeti sistem mesajı olarak ekle
    // 4. Eski mesajları sil/arşivle
    // 5. Context'i güncelle
  }
}
```

---

### 4. UI Bileşenleri

#### API Provider Settings
**Dosya:** `web-app/src/routes/settings/api-providers.tsx` (YENİ)
- API provider ekleme/düzenleme/silme
- Model listesi görüntüleme ve yenileme
- Test connection özelliği
- API key yönetimi

#### Usage Dashboard (Basit Versiyon)
**Dosya:** `web-app/src/routes/usage/dashboard.tsx` (YENİ)
- Güncel session bilgileri
- Günlük/aylık istatistikler
- Provider bazlı breakdown
- Basit bar/line charts (recharts kullanılabilir)

#### Chat Screen Updates
**Dosya:** `web-app/src/containers/TokenUsageIndicator.tsx` (YENİ)
```typescript
// Real-time token ve cost gösterimi
export function TokenUsageIndicator({ threadId }: { threadId: string }) {
  // Current message token count
  // Session total
  // Estimated cost
  // Context usage bar
}
```

**Dosya:** `web-app/src/containers/ContextUsageBar.tsx` (YENİ)
```typescript
// Context doluluk göstergesi
export function ContextUsageBar({ threadId }: { threadId: string }) {
  // Progress bar (current tokens / max tokens)
  // Warning at 80%
  // Auto-summarize indicator
}
```

---

## 📁 Değiştirilecek/Oluşturulacak Dosyalar

### YENİ DOSYALAR
1. `core/src/types/api/apiProvider.ts` - API provider tipleri
2. `core/src/types/tracking/usage.ts` - Usage tracking tipleri
3. `core/src/browser/extensions/api-manager.ts` - API manager extension
4. `core/src/browser/extensions/context-manager.ts` - Context manager extension
5. `extensions/api-manager-extension/` - Yeni extension (komple)
6. `extensions/context-manager-extension/` - Yeni extension (komple)
7. `web-app/src/services/usage/index.ts` - Usage tracker service
8. `web-app/src/hooks/useUsageTracking.ts` - Usage tracking hook
9. `web-app/src/routes/settings/api-providers.tsx` - API settings sayfası
10. `web-app/src/routes/usage/dashboard.tsx` - Usage dashboard
11. `web-app/src/containers/TokenUsageIndicator.tsx` - Token indicator
12. `web-app/src/containers/ContextUsageBar.tsx` - Context bar

### GÜNCELLENECEKETİ DOSYALAR
1. `core/src/browser/extensions/engines/EngineManager.ts` - Multi-provider support
2. `core/src/browser/extensions/inference.ts` - Usage tracking entegrasyonu
3. `core/src/types/thread/threadEntity.ts` - Context summary referansı ekle
4. `web-app/src/containers/ThreadList.tsx` - Usage info gösterimi
5. `web-app/src/routes/settings/providers/$providerName.tsx` - Custom provider support

---

## 🔄 İş Akışı

### 1. API Provider Ekleme
```
Kullanıcı → Settings → API Providers → Add Provider
→ Provider bilgileri gir (name, baseUrl, apiKey)
→ Test Connection
→ Fetch Models
→ Save Provider
```

### 2. Token Tracking
```
Her API Request
→ Request başlangıcında: timestamp kaydet
→ Request bitiminde: duration, token usage, cost hesapla
→ UsageTracker.logRequest()
→ Session ve global stats güncelle
→ UI'da real-time güncelleme
```

### 3. Auto-Summarization
```
Her mesaj gönderimi
→ Context kullanımını kontrol et
→ Eğer > 85%:
  → Eski mesajları seç
  → Özetleme API'sine gönder
  → Özeti thread'e ekle
  → Eski mesajları arşivle
  → Context'i güncelle
  → Kullanıcıya bildirim
```

---

## ⚡ Performans Optimizasyonları

### 1. Caching
- API model listelerini cache'le (24 saat)
- Usage statistics'i aggregate et (dakikalık/saatlik)
- Token counting'i client-side yap (token.js kullan)

### 2. Lazy Loading
- Usage dashboard grafikleri lazy load
- Eski conversation summaries on-demand yükle

### 3. Background Processing
- Context analysis ve summarization background'da
- Usage statistics calculation batched

### 4. Database Optimization
- Usage data için IndexedDB kullan
- Eski data auto-cleanup (90 gün)
- Efficient querying with indexes

---

## 🧪 Test Planı

### Unit Tests
- [ ] API provider CRUD operations
- [ ] Usage calculation accuracy
- [ ] Context analysis logic
- [ ] Cost calculation formulas

### Integration Tests
- [ ] Multi-provider conversation flow
- [ ] Auto-summarization trigger
- [ ] Usage tracking end-to-end
- [ ] API failover scenarios

### Performance Tests
- [ ] Token counting speed (1000 messages < 100ms)
- [ ] Context analysis (< 50ms)
- [ ] Usage stats query (< 200ms)
- [ ] UI rendering with real-time updates (60fps)

---

## 📊 Başarı Kriterleri

1. ✅ Kullanıcı minimum 3 farklı API provider ekleyebilmeli
2. ✅ Token/maliyet tracking %99 doğrulukla çalışmalı
3. ✅ Context 85%'e ulaştığında otomatik özetleme tetiklenmeli
4. ✅ Usage dashboard 1 saniyeden hızlı yüklenmeli
5. ✅ Real-time token indicator 100ms gecikmeyle güncellemeli
6. ✅ API provider değişimi kullanıcı deneyimini bozmamalı

---

## 🚀 Implementation Sırası

1. **Gün 1-2:** Type definitions ve core extensions
2. **Gün 3-4:** API manager extension implementasyonu
3. **Gün 5-6:** Usage tracking service ve storage
4. **Gün 7-8:** Context manager ve auto-summarization
5. **Gün 9-10:** UI components (settings, indicators)
6. **Gün 11-12:** Usage dashboard
7. **Gün 13-14:** Integration, testing ve optimization
8. **Gün 15:** Final testing ve bug fixes

---

## 🔗 Dependencies

### NPM Packages (Yeni)
```json
{
  "dependencies": {
    "tiktoken": "^1.0.10",        // Token counting
    "recharts": "^2.10.0",        // Charts
    "date-fns": "^3.0.0",         // Date utilities
    "zod": "^3.22.0"              // API validation
  }
}
```

---

## 📝 Notlar

- **OpenAI Compatible API:** Herhangi bir OpenAI uyumlu API eklenebilir (z.ai, groq, etc.)
- **Model Discovery:** Provider eklendikten sonra `/v1/models` endpoint'inden modeller çekilir
- **Pricing Data:** Manuel girilmeli (API'ler pricing bilgisi sağlamıyor)
- **Context Window:** Model bazında farklı olabilir, provider'dan gelecek
- **Summarization Model:** Özetleme için ayrı bir model kullanılabilir (küçük ve hızlı)

---

## ⚠️ Dikkat Edilecekler

1. **API Key Security:** API key'ler encrypted storage'da tutulmalı
2. **Rate Limiting:** Provider bazlı rate limit kontrolü
3. **Error Handling:** API failures gracefully handle edilmeli
4. **Cost Accuracy:** Pricing data güncel tutulmalı
5. **Context Safety:** Özetleme asla son kullanıcı mesajını silmemeli
6. **Performance:** Token counting her keystroke'da değil, throttled yapılmalı

---

## 🎯 Next Phase Preview

**Phase 2: Workspace ve Kurallar Sistemi**
- .leah klasör yapısı
- rules.md sistemi ve parser
- Workspace file operations (izinli)
- Rules enforcement engine
