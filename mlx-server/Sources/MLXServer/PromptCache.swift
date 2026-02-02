import Foundation
import MLX
import MLXLMCommon

/// Manages KV cache between generate calls to avoid re-processing common prompt prefixes
public class PromptCache: @unchecked Sendable {
    /// The stored KV cache layers
    private(set) var cache: [KVCache]
    /// The tokens corresponding to the cached KV state
    private(set) var tokens: MLXArray

    /// Maximum number of cached tokens (0 = unlimited)
    private let maxTokens: Int

    /// LRU tracking: hash of prompt -> last access time
    private var lruOrder: [String: Date]

    /// Cache hits and misses for metrics
    private var hits: Int = 0
    private var misses: Int = 0

    /// Lock for thread safety
    private let lock = NSLock()

    public init(cache: [KVCache], maxTokens: Int = 0) {
        self.cache = cache
        self.tokens = MLXArray()
        self.maxTokens = maxTokens
        self.lruOrder = [:]
    }

    /// Returns the suffix of the prompt not already in cache
    /// If nil is returned, the entire prompt should be processed
    public func getUncachedSuffix(prompt: MLXArray) -> MLXArray? {
        let comPrefixLength = commonPrefixLength(newPromptTokens: prompt)

        lock.lock()
        defer { lock.unlock() }

        if comPrefixLength == self.tokens.size {
            // All tokens already cached, return suffix to append
            let suffix = prompt[comPrefixLength..<prompt.size]
            if suffix.size > 0 {
                // Update LRU
                let hash = computeHash(for: prompt[0..<comPrefixLength])
                lruOrder[hash] = Date()
                return suffix
            }
            hits += 1
            return nil
        } else if comPrefixLength < self.tokens.size {
            // Part of the prompt diverges from cache
            // Check if we can trim the cache
            if isTrimmable() {
                let trimmed = trim(self.tokens.size - comPrefixLength)
                self.tokens = self.tokens[0..<comPrefixLength]
                let suffix = prompt[comPrefixLength..<prompt.size]
                if suffix.size > 0 {
                    let hash = computeHash(for: self.tokens)
                    lruOrder[hash] = Date()
                    return suffix
                }
            }
            misses += 1
            return nil
        }

        misses += 1
        return nil
    }

    /// Compute a hash for the given tokens
    private func computeHash(for tokens: MLXArray) -> String {
        // Simple hash using token values - in production, use a proper hash
        let tokenCount = Int(tokens.size)
        var hash = 0
        for i in 0..<min(tokenCount, 100) {
            let token = tokens[Int(i)].item(Int32.self)
            hash = hash &* 31 &+ Int(token)
        }
        return "hash_\(hash)"
    }

    /// Checks if all KV cache layers are trimmable
    public func isTrimmable() -> Bool {
        return cache.isEmpty || cache.allSatisfy { $0.isTrimmable }
    }

    /// Trims the cache by n tokens, returning the actual number trimmed
    @discardableResult
    public func trim(_ n: Int) -> Int {
        if cache.isEmpty || !isTrimmable() { return 0 }
        return cache.map { $0.trim(n) }.max() ?? 0
    }

    /// Returns the length of the common prefix between cached and new tokens
    public func commonPrefixLength(newPromptTokens: MLXArray) -> Int {
        let cachedCount = Int(self.tokens.size)
        let newCount = Int(newPromptTokens.size)

        let limit = min(cachedCount, newCount)
        for i in 0..<limit {
            let cachedToken = self.tokens[Int(i)].item(Int32.self)
            let newToken = newPromptTokens[Int(i)].item(Int32.self)
            if cachedToken != newToken {
                return i
            }
        }
        return limit
    }

    /// Updates the cache with new KV cache and tokens
    public func update(cache: [KVCache], tokens: MLXArray) {
        lock.lock()
        defer { lock.unlock() }

        // Check if we need to evict
        if maxTokens > 0 && Int(tokens.size) > maxTokens {
            // Evict oldest entries
            evictOldest(extraTokens: Int(tokens.size) - maxTokens)
        }

        self.cache = cache
        self.tokens = tokens

        // Update LRU
        let hash = computeHash(for: tokens)
        lruOrder[hash] = Date()

        log("[mlx] Prompt cache updated with \(tokens.size) tokens, \(cache.count) layers")
    }

    /// Evict oldest cache entries to stay within limits
    private func evictOldest(extraTokens: Int) {
        guard extraTokens > 0 else { return }

        // Sort by last access time
        let sortedEntries = lruOrder.sorted { $0.value < $1.value }

        var tokensToEvict = extraTokens
        for (hash, _) in sortedEntries {
            if tokensToEvict <= 0 { break }
            lruOrder.removeValue(forKey: hash)
            tokensToEvict -= 16  // Assume block size of 16
        }
    }

    /// Get cache metrics
    public func getMetrics() -> CacheMetrics {
        lock.lock()
        defer { lock.unlock() }

        let total = hits + misses
        let hitRate = total > 0 ? Double(hits) / Double(total) : 0.0

        return CacheMetrics(
            totalTokens: Int(tokens.size),
            layers: cache.count,
            hits: hits,
            misses: misses,
            hitRate: hitRate,
            maxTokens: maxTokens
        )
    }

    /// Clear the cache and reset metrics
    public func clear() {
        lock.lock()
        defer { lock.unlock() }

        cache = []
        tokens = MLXArray()
        lruOrder.removeAll()
        hits = 0
        misses = 0

        log("[mlx] Prompt cache cleared")
    }
}

// MARK: - Shared KV Cache Manager

/// Manages shared KV caches across multiple requests for common prefixes
/// This enables significant speedup when processing similar system prompts
final class SharedKVCacheManager: @unchecked Sendable {
    /// Shared cache entries indexed by prompt hash
    private var sharedCaches: [String: SharedCacheEntry] = [:]

    /// Lock for thread safety
    private let lock = NSLock()

    /// Maximum number of shared caches to maintain
    private let maxCaches: Int

    /// LRU tracking for eviction
    private var lruOrder: [String: Date] = [:]

    init(maxCaches: Int = 100) {
        self.maxCaches = maxCaches
    }

    /// Get or create a shared cache entry for the given prompt
    func getOrCreate(
        promptHash: String,
        promptTokens: MLXArray,
        cacheProvider: () -> [KVCache]
    ) -> SharedCacheEntry {
        lock.lock()
        defer { lock.unlock() }

        // Check if we have an existing cache
        if let existing = sharedCaches[promptHash] {
            // Update LRU
            lruOrder[promptHash] = Date()
            return existing
        }

        // Check if we need to evict
        if sharedCaches.count >= maxCaches {
            evictOldest()
        }

        // Create new cache
        let entry = SharedCacheEntry(
            tokens: promptTokens,
            cache: cacheProvider()
        )

        sharedCaches[promptHash] = entry
        lruOrder[promptHash] = Date()

        log("[mlx] Created shared KV cache for hash: \(promptHash)")

        return entry
    }

    /// Get cache entry if it exists (without creating)
    func getIfExists(_ promptHash: String) -> SharedCacheEntry? {
        lock.lock()
        defer { lock.unlock() }

        guard let entry = sharedCaches[promptHash] else { return nil }

        // Update LRU
        lruOrder[promptHash] = Date()
        return entry
    }

    /// Evict oldest cache entries
    private func evictOldest() {
        let sorted = lruOrder.sorted { $0.value < $1.value }
        let toRemove = sorted.prefix(maxCaches / 4)  // Remove 25%

        for (hash, _) in toRemove {
            sharedCaches.removeValue(forKey: hash)
            lruOrder.removeValue(forKey: hash)
        }

        log("[mlx] Evicted \(toRemove.count) shared KV caches")
    }

    /// Clear all shared caches
    func clearAll() {
        lock.lock()
        defer { lock.unlock() }

        sharedCaches.removeAll()
        lruOrder.removeAll()
        log("[mlx] All shared KV caches cleared")
    }

    /// Get statistics
    func getStats() -> SharedCacheStats {
        lock.lock()
        defer { lock.unlock() }

        return SharedCacheStats(
            cacheCount: sharedCaches.count,
            maxCaches: maxCaches
        )
    }
}

/// Entry in the shared KV cache
final class SharedCacheEntry {
    let tokens: MLXArray
    private(set) var cache: [KVCache]
    private(set) var useCount: Int = 0
    private(set) var lastAccess: Date

    init(tokens: MLXArray, cache: [KVCache]) {
        self.tokens = tokens
        self.cache = cache
        self.lastAccess = Date()
    }

    /// Use this cache entry
    func use() -> [KVCache] {
        useCount += 1
        lastAccess = Date()
        return cache
    }

    /// Update the underlying cache (e.g., after new tokens added)
    func updateCache(_ newCache: [KVCache]) {
        cache = newCache
    }
}

// MARK: - Supporting Types

/// Cache metrics
public struct CacheMetrics {
    let totalTokens: Int
    let layers: Int
    let hits: Int
    let misses: Int
    let hitRate: Double
    let maxTokens: Int
}

/// Statistics for shared cache manager
struct SharedCacheStats {
    let cacheCount: Int
    let maxCaches: Int
}
