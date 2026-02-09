import Foundation

/// Write a message to stdout and flush immediately for capture by Rust process
public func log(_ message: String) {
    let output = message + "\n"
    if let data = output.data(using: .utf8) {
        FileHandle.standardOutput.write(data)
    }
}