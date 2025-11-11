# PHASE 7: Performance Monitor & Dashboard

## 🎯 Amaç
Tüm AI operasyonlarını görselleştirerek token kullanımı, maliyet, hız ve model performansını detaylı şekilde izlemek.

## 📋 Özellikler
1. ✅ Real-time Performance Dashboard
2. ✅ Token Usage Analytics
3. ✅ Cost Tracking & Budgets
4. ✅ Model Benchmarking
5. ✅ Response Time Metrics
6. ✅ Performance Graphs & Charts
7. ✅ Alerts & Notifications
8. ✅ Export Reports

---

## 🏗️ Mimari Yapı

### 1. Performance Metrics Types

**Dosya:** `core/src/types/monitoring/metrics.ts` (YENİ)
```typescript
export type PerformanceMetrics = {
  threadId: string
  messageId: string
  model: string
  provider: string
  timestamp: number
  duration: {
    total: number          // Total response time (ms)
    ttfb: number          // Time to first byte (ms)
    streaming: number     // Streaming duration (ms)
  }
  tokens: {
    input: number
    output: number
    total: number
    speed: number         // Tokens per second
  }
  cost: {
    input: number
    output: number
    total: number
  }
  quality: {
    score?: number        // 0-100
    userRating?: number   // User's rating (1-5)
  }
  metadata: Record<string, any>
}

export type AggregatedMetrics = {
  period: 'hour' | 'day' | 'week' | 'month'
  startDate: number
  endDate: number
  totalRequests: number
  totalTokens: number
  totalCost: number
  averageResponseTime: number
  averageTokenSpeed: number
  byModel: Record<string, ModelMetrics>
  byProvider: Record<string, ProviderMetrics>
}

export type ModelMetrics = {
  modelId: string
  requests: number
  tokens: number
  cost: number
  avgResponseTime: number
  avgTokenSpeed: number
  successRate: number
  qualityScore: number
}

export type BenchmarkResult = {
  id: string
  name: string
  timestamp: number
  models: Array<{
    modelId: string
    provider: string
    results: {
      responseTime: number
      tokensPerSecond: number
      cost: number
      qualityScore: number
      accuracy?: number
    }
  }>
  testPrompt: string
  testCategory: string
}
```

---

### 2. Performance Monitor Extension

**Dosya:** `core/src/browser/extensions/performance-monitor.ts` (YENİ)
```typescript
export abstract class PerformanceMonitorExtension extends BaseExtension {
  type(): ExtensionTypeEnum | undefined {
    return ExtensionTypeEnum.PerformanceMonitor
  }

  // Metrics Collection
  abstract recordMetrics(metrics: PerformanceMetrics): Promise<void>
  abstract getMetrics(filters: MetricsFilter): Promise<PerformanceMetrics[]>

  // Aggregation
  abstract getAggregatedMetrics(
    period: 'hour' | 'day' | 'week' | 'month',
    startDate: number,
    endDate: number
  ): Promise<AggregatedMetrics>

  // Benchmarking
  abstract runBenchmark(
    models: string[],
    testPrompts: string[],
    category: string
  ): Promise<BenchmarkResult>
  abstract getBenchmarkHistory(): Promise<BenchmarkResult[]>

  // Alerts
  abstract setAlert(alert: PerformanceAlert): Promise<void>
  abstract checkAlerts(metrics: PerformanceMetrics): Promise<Alert[]>

  // Reports
  abstract generateReport(
    period: 'day' | 'week' | 'month',
    format: 'pdf' | 'csv' | 'json'
  ): Promise<Blob>
}
```

---

### 3. UI Components

#### Performance Dashboard
**Dosya:** `web-app/src/routes/monitoring/dashboard.tsx` (YENİ)
```typescript
export function PerformanceDashboard() {
  return (
    <div className="performance-dashboard">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard
          title="Total Requests"
          value={stats.totalRequests}
          change="+12%"
          trend="up"
        />
        <MetricCard
          title="Total Tokens"
          value={formatNumber(stats.totalTokens)}
          change="+8%"
          trend="up"
        />
        <MetricCard
          title="Total Cost"
          value={`$${stats.totalCost.toFixed(2)}`}
          change="-5%"
          trend="down"
        />
        <MetricCard
          title="Avg Response Time"
          value={`${stats.avgResponseTime}ms`}
          change="-3%"
          trend="down"
        />
      </div>

      {/* Time Series Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Token Usage Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <LineChart data={tokenUsageData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cost Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <AreaChart data={costData} />
          </CardContent>
        </Card>
      </div>

      {/* Model Comparison */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Model Performance Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <BarChart data={modelComparisonData} />
        </CardContent>
      </Card>

      {/* Provider Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Usage by Provider</CardTitle>
          </CardHeader>
          <CardContent>
            <PieChart data={providerData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cost by Provider</CardTitle>
          </CardHeader>
          <CardContent>
            <PieChart data={providerCostData} />
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recent API Calls</CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityTable data={recentActivity} />
        </CardContent>
      </Card>
    </div>
  )
}
```

#### Model Benchmark Tool
**Dosya:** `web-app/src/routes/monitoring/benchmark.tsx` (YENİ)
```typescript
export function ModelBenchmark() {
  return (
    <div className="benchmark-tool">
      <Card>
        <CardHeader>
          <CardTitle>Run Benchmark Test</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Model Selection */}
          <MultiSelect
            label="Select Models to Test"
            options={availableModels}
            value={selectedModels}
            onChange={setSelectedModels}
          />

          {/* Test Category */}
          <Select label="Test Category" value={category} onChange={setCategory}>
            <option value="coding">Coding</option>
            <option value="reasoning">Reasoning</option>
            <option value="creative">Creative Writing</option>
            <option value="analysis">Analysis</option>
          </Select>

          {/* Test Prompts */}
          <Textarea
            label="Test Prompts (one per line)"
            value={prompts}
            onChange={e => setPrompts(e.target.value)}
            rows={10}
          />

          <Button onClick={runBenchmark} disabled={isRunning}>
            {isRunning ? 'Running...' : 'Run Benchmark'}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {benchmarkResult && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Benchmark Results</CardTitle>
          </CardHeader>
          <CardContent>
            <BenchmarkResultsTable result={benchmarkResult} />
            <BenchmarkChart result={benchmarkResult} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
```

#### Budget & Alerts
**Dosya:** `web-app/src/routes/monitoring/budgets.tsx` (YENİ)
```typescript
export function BudgetsAndAlerts() {
  return (
    <div className="budgets-alerts">
      {/* Budget Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Budget Limits</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <Label>Daily Budget</Label>
              <Input
                type="number"
                value={dailyBudget}
                onChange={e => setDailyBudget(e.target.value)}
                prefix="$"
              />
              <Progress value={dailySpend / dailyBudget * 100} />
              <span className="text-sm">
                ${dailySpend.toFixed(2)} / ${dailyBudget} used today
              </span>
            </div>

            <div>
              <Label>Monthly Budget</Label>
              <Input
                type="number"
                value={monthlyBudget}
                onChange={e => setMonthlyBudget(e.target.value)}
                prefix="$"
              />
              <Progress value={monthlySpend / monthlyBudget * 100} />
              <span className="text-sm">
                ${monthlySpend.toFixed(2)} / ${monthlyBudget} used this month
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Alerts */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Alert Rules</CardTitle>
          <Button onClick={addAlert}>Add Alert</Button>
        </CardHeader>
        <CardContent>
          <AlertsList alerts={alerts} />
        </CardContent>
      </Card>
    </div>
  )
}
```

---

### 4. Charts & Visualizations

Using **Recharts** for visualizations:
- Line Chart: Token usage, cost, response time over time
- Bar Chart: Model comparison
- Pie Chart: Provider distribution
- Area Chart: Cumulative metrics
- Scatter Plot: Token speed vs quality

---

## 📁 Yeni Dosyalar

### Core
1. `core/src/types/monitoring/metrics.ts`
2. `core/src/browser/extensions/performance-monitor.ts`

### Extension
3. `extensions/performance-monitor-extension/` (yeni)

### Web App
4. `web-app/src/routes/monitoring/dashboard.tsx`
5. `web-app/src/routes/monitoring/benchmark.tsx`
6. `web-app/src/routes/monitoring/budgets.tsx`
7. `web-app/src/components/monitoring/MetricCard.tsx`
8. `web-app/src/components/monitoring/ActivityTable.tsx`
9. `web-app/src/components/monitoring/BenchmarkChart.tsx`
10. `web-app/src/hooks/usePerformanceMetrics.ts`

---

## 🔗 Dependencies

```json
{
  "dependencies": {
    "recharts": "^2.10.0",      // Charts
    "date-fns": "^3.0.0",        // Date formatting
    "react-window": "^1.8.10"    // Virtual scrolling (for large datasets)
  }
}
```

---

## 🚀 Implementation: 10-12 gün

---

## 📊 Başarı Kriterleri

1. ✅ Dashboard loads < 1s
2. ✅ Real-time updates < 500ms
3. ✅ Charts render < 200ms
4. ✅ Benchmark runs < 5min (3 models, 10 prompts)
5. ✅ Export reports < 2s

---

## 🎯 Next Phase: Phase 8 - Agent Sistemi
