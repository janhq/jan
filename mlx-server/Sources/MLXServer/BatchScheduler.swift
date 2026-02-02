import Foundation
import MLX
import MLXLLM
import MLXLMCommon
import Hummingbird

// MARK: - Batching Configuration

/// Configuration for batch processing
public struct BatchingConfig: Sendable {
    public var maxBatchSize: Int
    public var batchTimeoutMs: Int
    public var maxModelTokens: Int
    public var enableContinuousBatching: Bool
    public var kvBlockSize: Int
    public var enablePrefixCatching: Bool

    public var batchTimeout: TimeInterval {
        TimeInterval(batchTimeoutMs) / 1000.0
    }

    public static let `default` = BatchingConfig(
        maxBatchSize: 8,
        batchTimeoutMs: 50,
        maxModelTokens: 4096,
        enableContinuousBatching: true,
        kvBlockSize: 16,
        enablePrefixCatching: true
    )
}

// MARK: - Batch Request

/// A request waiting in the queue for batch processing
struct BatchRequest: Identifiable, Sendable {
    let id: String
    let chatRequest: ChatCompletionRequest
    let createdAt: Date
    var priority: Int
    var timeoutTimer: Task<Void, Never>?

    init(
        id: String = UUID().uuidString,
        chatRequest: ChatCompletionRequest,
        createdAt: Date = Date(),
        priority: Int = 0
    ) {
        self.id = id
        self.chatRequest = chatRequest
        self.createdAt = createdAt
        self.priority = priority
    }

    /// Create a copy with a modified timeout timer
    func withTimeout(_ timer: Task<Void, Never>?) -> BatchRequest {
        var copy = self
        copy.timeoutTimer = timer
        return copy
    }
}

// MARK: - Active Request

/// Tracks a request currently being processed
struct ActiveRequest: Identifiable, Sendable {
    let id: String
    let request: BatchRequest
    var startTime: Date
    var tokensGenerated: Int = 0

    var latencyMs: TimeInterval {
        Date().timeIntervalSince(startTime) * 1000
    }
}

// MARK: - Batch Context

/// Holds the prepared input and cache for a batch item
struct BatchContext: Sendable {
    let requestId: String
    var lmInput: LMInput
    var cache: [KVCache]
    var parameters: GenerateParameters
    var originalRequest: ChatCompletionRequest
}

// MARK: - Batching Metrics

/// Tracks batch processing statistics
struct BatchingMetrics: Sendable {
    var totalRequestsProcessed: Int = 0
    var totalBatchesProcessed: Int = 0
    var totalTokensGenerated: Int = 0
    var totalLatencyMs: Double = 0
    var cacheHits: Int = 0
    var cacheMisses: Int = 0

    var avgLatencyMs: Double {
        guard totalRequestsProcessed > 0 else { return 0 }
        return totalLatencyMs / Double(totalRequestsProcessed)
    }

    var avgBatchSize: Double {
        guard totalBatchesProcessed > 0 else { return 0 }
        return Double(totalRequestsProcessed) / Double(totalBatchesProcessed)
    }

    var cacheHitRate: Double {
        let total = cacheHits + cacheMisses
        guard total > 0 else { return 0 }
        return Double(cacheHits) / Double(total)
    }

    mutating func recordRequest(latencyMs: Double, tokens: Int, cacheHit: Bool) {
        totalRequestsProcessed += 1
        totalLatencyMs += latencyMs
        totalTokensGenerated += tokens
        if cacheHit {
            cacheHits += 1
        } else {
            cacheMisses += 1
        }
    }

    mutating func recordBatch(size: Int) {
        totalBatchesProcessed += 1
    }
}

// MARK: - Request Scheduler

/// Manages the queue of requests waiting for batch processing
actor RequestScheduler {
    private var waitingQueue: [BatchRequest] = []
    private var runningRequests: [String: ActiveRequest] = [:]
    private let config: BatchingConfig
    private var metrics = BatchingMetrics()
    private var isProcessing = false
    private var batchProcessor: BatchProcessor?

    init(config: BatchingConfig) {
        self.config = config
    }

    func setBatchProcessor(_ processor: BatchProcessor) {
        self.batchProcessor = processor
    }

    var status: (waitingCount: Int, runningCount: Int, maxBatchSize: Int, metrics: BatchingMetrics) {
        (waitingQueue.count, runningRequests.count, config.maxBatchSize, metrics)
    }

    /// Enqueue a request for batch processing
    func enqueue(_ request: BatchRequest, timeout: TimeInterval = 30.0) {
        // Cancel any existing timeout
        request.timeoutTimer?.cancel()

        let requestId = request.id  // Capture for timeout closure

        // Set up timeout timer
        let timer = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))

            guard let self = self else { return }

            // Check if request is still waiting (actor-isolated access)
            await self.checkAndRemoveTimedOutRequest(id: requestId, timeout: timeout)
        }

        let updatedRequest = request.withTimeout(timer)
        waitingQueue.append(updatedRequest)
    }

    /// Check and remove timed out requests (actor-isolated)
    private func checkAndRemoveTimedOutRequest(id: String, timeout: TimeInterval) {
        if let index = waitingQueue.firstIndex(where: { $0.id == id }) {
            waitingQueue.remove(at: index)
            log("[mlx] Request \(id) timed out after \(timeout)s")
        }
    }

    /// Get the next batch of requests to process
    func getNextBatch() -> [BatchRequest] {
        let now = Date()

        // Remove timed out requests
        waitingQueue.removeAll { now.timeIntervalSince($0.createdAt) > config.batchTimeout }

        // For continuous batching, add slots from finished requests
        let availableSlots = config.maxBatchSize - runningRequests.count

        // For static batching, wait until we have enough requests
        if !config.enableContinuousBatching && waitingQueue.count < config.maxBatchSize {
            return []
        }

        guard waitingQueue.count > 0 else { return [] }

        // Sort by priority (higher first) then by creation time (older first)
        waitingQueue.sort { lhs, rhs in
            if lhs.priority != rhs.priority {
                return lhs.priority > rhs.priority
            }
            return lhs.createdAt < rhs.createdAt
        }

        // Fill batch
        let batchSize = min(waitingQueue.count, max(availableSlots, config.maxBatchSize))
        let batch = Array(waitingQueue.prefix(batchSize))

        // Remove from waiting queue
        waitingQueue.removeFirst(batchSize)

        return batch
    }

    /// Mark requests as started
    func markRequestsStarted(_ requests: [BatchRequest]) {
        for request in requests {
            runningRequests[request.id] = ActiveRequest(
                id: request.id,
                request: request,
                startTime: Date()
            )
        }
    }

    /// Mark a request as completed
    func markRequestCompleted(id: String, latencyMs: Double, tokensGenerated: Int, cacheHit: Bool) {
        runningRequests.removeValue(forKey: id)
        metrics.recordRequest(latencyMs: latencyMs, tokens: tokensGenerated, cacheHit: cacheHit)
    }

    /// Mark a batch as processed
    func markBatchProcessed(size: Int) {
        metrics.recordBatch(size: size)
    }

    /// Process batches continuously
    /// Uses adaptive waiting for better throughput under varying load
    func processBatches() async throws {
        guard !isProcessing else { return }
        isProcessing = true
        defer { isProcessing = false }

        // Adaptive sleep duration based on queue state
        var baseSleepNs: UInt64 = 10_000_000 // 10ms baseline

        while !Task.isCancelled {
            let batch = getNextBatch()
            if !batch.isEmpty {
                do {
                    _ = try await executeBatch(batch)
                    // After successful batch, use shorter sleep (high utilization)
                    baseSleepNs = 5_000_000 // 5ms
                } catch {
                    log("[mlx] Batch execution error: \(error.localizedDescription)")
                    // On error, back off slightly
                    baseSleepNs = 20_000_000 // 20ms
                }
            } else {
                // No batch - use longer sleep when queue is empty
                let queueEmpty = waitingQueue.isEmpty
                baseSleepNs = queueEmpty ? 10_000_000 : 2_000_000 // 10ms empty, 2ms waiting

                try? await Task.sleep(nanoseconds: baseSleepNs)
            }
        }
    }

    private func executeBatch(_ batch: [BatchRequest]) async throws -> [BatchResult] {
        guard let processor = batchProcessor else {
            log("[mlx] No batch processor available")
            return []
        }

        return try await processor.executeBatch(batch, batchingConfig: config)
    }
}

// MARK: - Queue Status

struct QueueStatus: Sendable {
    let waitingCount: Int
    let runningCount: Int
    let maxBatchSize: Int
    let metrics: BatchingMetrics
}

// MARK: - Batch Result

/// Result of a batched inference request
struct BatchResult: Sendable {
    let requestId: String
    let text: String
    let toolCalls: [ToolCallInfo]
    let usage: UsageInfo
    let latencyMs: Double
}

// MARK: - Batch Processor

/// Handles actual batch processing of requests
actor BatchProcessor {
    private let modelRunner: ModelRunner
    private let config: BatchingConfig

    init(modelRunner: ModelRunner, config: BatchingConfig) {
        self.modelRunner = modelRunner
        self.config = config
    }

    func executeBatch(_ requests: [BatchRequest], batchingConfig: BatchingConfig) async throws -> [BatchResult] {
        log("[mlx] Processing batch of \(requests.count) requests")

        // Use the model's batch execution
        let chatRequests = requests.map { $0.chatRequest }

        do {
            let results = try await modelRunner.executeBatch(requests: chatRequests, config: batchingConfig)
            log("[mlx] Batch completed: \(results.count) results")
            return results
        } catch {
            log("[mlx] Batch execution failed: \(error.localizedDescription)")
            throw error
        }
    }

    func getStatus() async -> QueueStatus {
        // Return default status - actual status comes from RequestScheduler
        QueueStatus(
            waitingCount: 0,
            runningCount: 0,
            maxBatchSize: config.maxBatchSize,
            metrics: BatchingMetrics()
        )
    }
}

// MARK: - Batching Errors

enum BatchingError: Error, LocalizedError {
    case queueEmpty
    case batchTimeout
    case invalidRequest(String)
    case processingFailed(String)

    var errorDescription: String? {
        switch self {
        case .queueEmpty:
            return "Request queue is empty"
        case .batchTimeout:
            return "Batch processing timed out"
        case .invalidRequest(let reason):
            return "Invalid request: \(reason)"
        case .processingFailed(let reason):
            return "Processing failed: \(reason)"
        }
    }
}