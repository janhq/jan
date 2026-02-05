//
//  PromptCache.swift
//  mlx-swift-examples
//
//  Created by Jolon Faichney on 3/5/2025.
//

import MLX
import MLXLMCommon

/// Stores the KV Cache between calls to ``generate`` and maintains
/// the token ids reflected in the cache.
///
/// ``PromptCache`` is ``@unchecked Sendable`` which allows it
/// to be used within the ``ModelContainer`` context.
///
/// TODO: cache isolation
public class PromptCache: @unchecked Sendable {
    private(set) var cache: [KVCache]
    private(set) var tokens: MLXArray

    public init(cache: [KVCache]) {
        log("[PromptCache.init]")
        self.cache = cache
        self.tokens = []
    }

    /// Returns the suffix of the prompt not already in cache, so that only
    /// the new part is processed. The tokens of the cache are adjusted here
    /// to reflect the new full prompt (i.e. the suffix tokens are added to the
    /// cache tokens array), assuming that the prompt suffix will
    /// be processed after the call to this function.
    ///
    /// Trims cache if necessary if part of the cache doesn't match the new
    /// prompt. If the model doesn't support trimming and the cache needs to be
    /// trimmed, will return nil for the caller to create a new cache.
    ///
    /// - Returns:
    ///     - If entirety of cache is in the new prompt:
    ///         - Return suffix of new prompt, less what is in the cache
    ///     - If only a portion of the cache is in the new prompt:
    ///         - Attempt to trim the cache to the common prefix
    ///         - Return suffix of prompt not in cache
    ///         - If the cache is not trimmable return nil for the caller
    ///             to create a new cache.
    public func getUncachedSuffix(prompt: MLXArray) -> MLXArray? {

        let comPrefixLength = commonPrefixLength(newPromptTokens: prompt)

        if comPrefixLength == self.tokens.size {
            let suffix = prompt[comPrefixLength ..< prompt.size]
            self.tokens = concatenated([self.tokens, suffix], axis: 0)
            return suffix
        } else if comPrefixLength < self.tokens.size {
            if isTrimmable() {
                let trimmedLen = self.trim(self.tokens.size - comPrefixLength)
                if trimmedLen != self.tokens.size - comPrefixLength {
                    log("Warning: request trimmed amount and actual trimmed amount are different")
                }
                self.tokens = self.tokens[0 ..< comPrefixLength]
                let suffix = prompt[comPrefixLength ..< prompt.size]
                self.tokens = concatenated([self.tokens, suffix], axis: 0)
                return suffix
            } else {
                // Caller must create a new cache
                return nil
            }
        }

        return nil
    }

    /// - Returns: true if all KV caches are trimmable
    public func isTrimmable() -> Bool {
        return cache.allSatisfy { $0.isTrimmable }
    }

    /// Trims all KV caches.
    /// - Parameters:
    ///   - n: Amount to trim.
    /// - Returns: Amount KV Caches were trimmed (may be less than ``n``).
    public func trim(_ n: Int) -> Int {
        if !self.isTrimmable() {
            return 0
        }
        return cache.map { $0.trim(n) }.max() ?? 0
    }

    /// Finds the common prefix between the cached prompt and
    /// the new prompt.
    /// - Parameters:
    ///   - newPromptTokens: Tokens to compare with cached tokens.
    /// - Returns: Length of the common prefix
    public func commonPrefixLength(newPromptTokens: MLXArray) -> Int {
        return commonPrefixLength(self.tokens, newPromptTokens)
    }

    /// Finds the common prefix between ``MLXArray``s.
    /// - Parameters:
    ///   - array1: First array
    ///   - array2: Second array
    /// - Returns: Length of the common prefix
    public func commonPrefixLength(_ array1: MLXArray, _ array2: MLXArray) -> Int {
        // TODO: Add test cases
        let minLength = min(array1.size, array2.size)
        for i in 0 ..< minLength {
            if all(array1[i] .!= array2[i]).item(Bool.self) {
                return i
            }
        }
        return minLength
    }

}
