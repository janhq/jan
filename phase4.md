# PHASE 4: Multi-Model Chat ve Karşılaştırma

## 🎯 Amaç
Kullanıcının aynı anda 2-3 farklı AI modeliyle konuşabilmesi, yanıtları karşılaştırabilmesi ve en iyi performansı gösteren modeli seçebilmesi.

## 📋 Özellikler
1. ✅ Multi-Model Chat Interface (2-3 model paralel)
2. ✅ Side-by-Side Comparison View
3. ✅ Model Response Comparison
4. ✅ Response Quality Metrics
5. ✅ Best Response Selection
6. ✅ Model Performance Tracking

---

## 🏗️ Mimari Yapı

### 1. Multi-Model Thread Type

**Dosya:** `core/src/types/thread/multiModelThread.ts` (YENİ)
```typescript
export type MultiModelThread = Thread & {
  multiModel: {
    enabled: boolean
    models: Array<{
      id: string
      modelInfo: ModelInfo
      provider: string
      enabled: boolean
    }>
    layout: 'side-by-side' | 'stacked' | 'tabs'
    syncScroll: boolean
  }
}

export type MultiModelMessage = Message & {
  multiModelResponses: Array<{
    modelId: string
    content: string
    status: 'pending' | 'streaming' | 'completed' | 'error'
    metrics: ResponseMetrics
    timestamp: number
    duration: number
  }>
  selectedResponse?: string  // modelId of best response
}

export type ResponseMetrics = {
  responseTime: number      // milliseconds
  tokensPerSecond: number
  totalTokens: number
  cost: number
  quality?: {
    coherence: number       // 0-1
    relevance: number       // 0-1
    completeness: number    // 0-1
  }
}
```

---

### 2. Multi-Model Inference Extension

**Dosya:** `core/src/browser/extensions/multi-inference.ts` (YENİ)
```typescript
export abstract class MultiModelInferenceExtension extends BaseExtension {
  type(): ExtensionTypeEnum | undefined {
    return ExtensionTypeEnum.MultiInference
  }

  /**
   * Send message to multiple models simultaneously
   */
  abstract inferenceMultiple(
    models: ModelInfo[],
    message: MessageRequest
  ): Promise<MultiModelMessage>

  /**
   * Compare responses
   */
  abstract compareResponses(
    responses: MultiModelMessage['multiModelResponses']
  ): {
    fastest: string
    cheapest: string
    mostRelevant: string
    recommended: string
  }

  /**
   * Rank models by performance
   */
  abstract rankModels(
    criteria: 'speed' | 'cost' | 'quality' | 'balanced'
  ): Promise<Array<{ modelId: string, score: number }>>
}
```

---

### 3. UI Components

#### Multi-Model Chat Interface
**Dosya:** `web-app/src/routes/thread/$threadId/multi-model.tsx` (YENİ)
```typescript
export function MultiModelChat() {
  const { threadId } = useParams()
  const { models, layout } = useMultiModelSettings(threadId)

  return (
    <div className="multi-model-chat">
      {/* Model selector - checkboxes for 2-3 models */}
      <ModelSelector
        selectedModels={models}
        onChange={updateModels}
        max={3}
      />

      {/* Layout switcher */}
      <LayoutSwitcher layout={layout} onChange={setLayout} />

      {/* Multi-model message list */}
      <MultiModelMessageList layout={layout} />

      {/* Input area */}
      <MessageInput onSend={sendToAllModels} />
    </div>
  )
}
```

#### Side-by-Side Response View
**Dosya:** `web-app/src/components/multi-model/SideBySideView.tsx` (YENİ)
```typescript
export function SideBySideView({ message }: { message: MultiModelMessage }) {
  const responses = message.multiModelResponses

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
      {responses.map(response => (
        <ResponsePanel
          key={response.modelId}
          response={response}
          isSelected={message.selectedResponse === response.modelId}
          onSelect={() => selectResponse(response.modelId)}
        />
      ))}
    </div>
  )
}
```

#### Response Comparison Table
**Dosya:** `web-app/src/components/multi-model/ComparisonTable.tsx` (YENİ)
```typescript
export function ComparisonTable({ responses }: Props) {
  return (
    <table className="comparison-table">
      <thead>
        <tr>
          <th>Metric</th>
          {responses.map(r => (
            <th key={r.modelId}>{r.modelId}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Response Time</td>
          {responses.map(r => (
            <td key={r.modelId}>{r.metrics.responseTime}ms</td>
          ))}
        </tr>
        <tr>
          <td>Tokens/sec</td>
          {responses.map(r => (
            <td key={r.modelId}>{r.metrics.tokensPerSecond}</td>
          ))}
        </tr>
        <tr>
          <td>Cost</td>
          {responses.map(r => (
            <td key={r.modelId}>${r.metrics.cost}</td>
          ))}
        </tr>
        <tr>
          <td>Quality Score</td>
          {responses.map(r => (
            <td key={r.modelId}>
              {calculateQualityScore(r.metrics.quality)}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  )
}
```

---

## 📁 Yeni/Güncellenecek Dosyalar

### YENİ DOSYALAR
1. `core/src/types/thread/multiModelThread.ts`
2. `core/src/browser/extensions/multi-inference.ts`
3. `extensions/multi-inference-extension/` (yeni extension)
4. `web-app/src/routes/thread/$threadId/multi-model.tsx`
5. `web-app/src/components/multi-model/SideBySideView.tsx`
6. `web-app/src/components/multi-model/ComparisonTable.tsx`
7. `web-app/src/components/multi-model/ModelSelector.tsx`
8. `web-app/src/components/multi-model/ResponsePanel.tsx`
9. `web-app/src/hooks/useMultiModelChat.ts`
10. `web-app/src/services/multi-model/index.ts`

### GÜNCELLENECEK
1. `core/src/types/thread/threadEntity.ts` - Multi-model field ekle
2. `web-app/src/routes/thread/$threadId/index.tsx` - Multi-model toggle

---

## ⚡ Performans

1. **Parallel Requests:** Tüm modeller paralel çağrılacak
2. **Streaming:** Her model kendi stream'ini gönderecek
3. **UI Updates:** Throttled (max 10fps per model)
4. **Memory:** Response caching ve cleanup

---

## 🚀 Implementation: 10-12 gün

---

## 🎯 Next Phase: Phase 5 - RAG Sistemi
