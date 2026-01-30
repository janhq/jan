import MLX
import MLXLMCommon

/// Manages KV cache between generate calls to avoid re-processing common prompt prefixes
public class PromptCache: @unchecked Sendable {
    /// The stored KV cache layers
    private(set) var cache: [KVCache]
    /// The tokens corresponding to the cached KV state
    private(set) var tokens: MLXArray

    public init(cache: [KVCache]) {
        self.cache = cache
        self.tokens = MLXArray()
    }

    /// Returns the suffix of the prompt not already in cache
    /// If nil is returned, the entire prompt should be processed
    public func getUncachedSuffix(prompt: MLXArray) -> MLXArray? {
        let comPrefixLength = commonPrefixLength(newPromptTokens: prompt)

        if comPrefixLength == self.tokens.size {
            // All tokens already cached, return suffix to append
            let suffix = prompt[comPrefixLength..<prompt.size]
            if suffix.size > 0 {
                self.tokens = concatenated([self.tokens, suffix], axis: 0)
                return suffix
            }
            return nil
        } else if comPrefixLength < self.tokens.size {
            // Part of the prompt diverges from cache
            // Check if we can trim the cache
            if isTrimmable() {
                let _ = trim(self.tokens.size - comPrefixLength)
                self.tokens = self.tokens[0..<comPrefixLength]
                let suffix = prompt[comPrefixLength..<prompt.size]
                if suffix.size > 0 {
                    self.tokens = concatenated([self.tokens, suffix], axis: 0)
                    return suffix
                }
            }
            return nil
        }

        return nil
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
        self.cache = cache
        self.tokens = tokens
        log("[mlx] Prompt cache updated with \(tokens.size) tokens, \(cache.count) layers")
    }
}
