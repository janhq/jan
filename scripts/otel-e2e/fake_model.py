"""An OpenAI-compatible /v1/chat/completions stub: the first request answers
with one shell tool call, every later one with plain text. Streams SSE."""
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

calls = 0

def chunk(delta, finish=None, usage=None):
    body = {"id": "x", "object": "chat.completion.chunk", "created": 1, "model": "fake-model",
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}
    if usage:
        body["usage"] = usage
    return f"data: {json.dumps(body)}\n\n"

class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        body = json.dumps({"object": "list", "data": [{"id": "fake-model", "object": "model"}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        global calls
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        calls += 1
        usage = {"prompt_tokens": 120, "completion_tokens": 8, "total_tokens": 128,
                 "prompt_tokens_details": {"cached_tokens": 64}}
        if calls == 1:
            call = {"index": 0, "id": "call_1", "type": "function",
                    "function": {"name": "shell", "arguments": json.dumps({"command": "echo otel-e2e"})}}
            out = chunk({"role": "assistant", "tool_calls": [call]}) + chunk({}, "tool_calls", usage)
        else:
            out = chunk({"role": "assistant", "content": "done"}) + chunk({}, "stop", usage)
        out += "data: [DONE]\n\n"
        data = out.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
