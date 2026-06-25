import Foundation

// Splits a streaming model output into reasoning_content and content based on
// <think> / </think> markers, mirroring how llamacpp's --reasoning-format
// option exposes the split to OpenAI-compatible clients.
//
// Handles three cases:
//   1. Explicit:  "<think>...</think>final answer"
//        — drop the opening <think>, route body to reasoning, drop </think>,
//          route the rest to content.
//   2. Implicit:  "...reasoning text...</think>final answer"
//        — chat template seeded "<think>" into the prompt, so the model output
//          only contains the closer. Treat everything before </think> as
//          reasoning.
//   3. None:      "plain content"
//        — no tags at all; emit as content.
//
// The splitter buffers a small head window to disambiguate cases 1/2/3 before
// committing, and keeps a trailing window of "</think>".count chars to handle
// a closing tag that straddles a token boundary.

struct ReasoningSplitter {
    private var buffer: String = ""
    private var resolved: Bool = false
    private var inReasoning: Bool = false

    private static let openTag = "<think>"
    private static let closeTag = "</think>"
    private static let resolveWindow = 32

    init(startInReasoning: Bool = false) {
        if startInReasoning {
            self.resolved = true
            self.inReasoning = true
        }
    }

    /// Feed a streamed token. Returns whatever can now be safely emitted.
    mutating func feed(_ token: String) -> (content: String?, reasoning: String?) {
        buffer += token

        if !resolved {
            if let r = buffer.range(of: Self.openTag) {
                // Explicit reasoning opener.
                buffer.removeSubrange(buffer.startIndex..<r.upperBound)
                inReasoning = true
                resolved = true
            } else if let r = buffer.range(of: Self.closeTag) {
                // Implicit reasoning (no opener, model went straight into thinking).
                let reasoning = String(buffer[buffer.startIndex..<r.lowerBound])
                buffer.removeSubrange(buffer.startIndex..<r.upperBound)
                inReasoning = false
                resolved = true
                let content = drainSafe()
                return (
                    content.isEmpty ? nil : content,
                    reasoning.isEmpty ? nil : reasoning
                )
            } else if buffer.count >= Self.resolveWindow {
                // No tags in the head window — treat as plain content.
                inReasoning = false
                resolved = true
            } else {
                // Still waiting for enough chars to decide.
                return (nil, nil)
            }
        }

        if inReasoning {
            if let r = buffer.range(of: Self.closeTag) {
                let reasoning = String(buffer[buffer.startIndex..<r.lowerBound])
                buffer.removeSubrange(buffer.startIndex..<r.upperBound)
                inReasoning = false
                let content = drainSafe()
                return (
                    content.isEmpty ? nil : content,
                    reasoning.isEmpty ? nil : reasoning
                )
            }
            let chunk = drainSafe()
            return (nil, chunk.isEmpty ? nil : chunk)
        }

        let chunk = drainSafe()
        return (chunk.isEmpty ? nil : chunk, nil)
    }

    /// Flush whatever is still buffered when the stream ends.
    mutating func finish() -> (content: String?, reasoning: String?) {
        if buffer.isEmpty { return (nil, nil) }
        let remainder = buffer
        buffer = ""
        if !resolved {
            // Never decided — treat the whole thing as content.
            return (remainder.isEmpty ? nil : remainder, nil)
        }
        if inReasoning {
            return (nil, remainder.isEmpty ? nil : remainder)
        }
        return (remainder.isEmpty ? nil : remainder, nil)
    }

    /// Pull out the safe prefix of the buffer (everything except the trailing
    /// region that could still be a partial closing tag).
    private mutating func drainSafe() -> String {
        let tagLen = Self.closeTag.count
        if buffer.count <= tagLen { return "" }
        let safeLen = buffer.count - tagLen
        let safe = String(buffer.prefix(safeLen))
        buffer = String(buffer.suffix(tagLen))
        return safe
    }
}
