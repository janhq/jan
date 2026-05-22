import Foundation
import MLXLMCommon
import Tokenizers

// PR #118 in mlx-swift-lm decoupled the tokenizer/downloader packages from
// the core libraries: loadModel now requires the caller to supply a
// TokenizerLoader. We use huggingface/swift-transformers' AutoTokenizer and
// adapt its Tokenizer protocol to MLXLMCommon's parallel one.

struct SwiftTransformersTokenizerLoader: MLXLMCommon.TokenizerLoader {
    func load(from directory: URL) async throws -> any MLXLMCommon.Tokenizer {
        let inner = try await Tokenizers.AutoTokenizer.from(modelFolder: directory)
        return SwiftTransformersTokenizerAdapter(inner: inner)
    }
}

private struct SwiftTransformersTokenizerAdapter: MLXLMCommon.Tokenizer {
    let inner: any Tokenizers.Tokenizer

    func encode(text: String, addSpecialTokens: Bool) -> [Int] {
        inner.encode(text: text, addSpecialTokens: addSpecialTokens)
    }

    func decode(tokenIds: [Int], skipSpecialTokens: Bool) -> String {
        inner.decode(tokens: tokenIds, skipSpecialTokens: skipSpecialTokens)
    }

    func convertTokenToId(_ token: String) -> Int? {
        inner.convertTokenToId(token)
    }

    func convertIdToToken(_ id: Int) -> String? {
        inner.convertIdToToken(id)
    }

    var bosToken: String? { inner.bosToken }
    var eosToken: String? { inner.eosToken }
    var unknownToken: String? { inner.unknownToken }

    func applyChatTemplate(
        messages: [[String: any Sendable]],
        tools: [[String: any Sendable]]?,
        additionalContext: [String: any Sendable]?
    ) throws -> [Int] {
        try inner.applyChatTemplate(
            messages: messages,
            tools: tools,
            additionalContext: additionalContext
        )
    }
}
