#!/usr/bin/env python3
"""OpenAI-compatible HTTP server for Jan's on-device inference engines.

Jan talks to a local engine the same way it talks to llama.cpp and MLX: over
HTTP, with the OpenAI chat-completions shape. This module is the sidecar that
makes that possible for the two CPU engines Jan supports:

  litert-lm  Google's LiteRT-LM runtime (CPU / GPU / NPU backends)
  openvino   Intel's OpenVINO GenAI runtime (CPU / GPU / NPU)

The server is intentionally dependency-light: only the standard library plus
the runtime package for the selected engine. It exposes

  GET  /health
  GET  /v1/models
  POST /v1/chat/completions   (streaming and buffered)
  POST /v1/completions

Usage:
  python server.py --engine litert-lm --model /path/to/model.task --port 9379
  python server.py --engine openvino  --model /path/to/model-dir   --port 9379
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Iterator, Sequence

# ---------------------------------------------------------------------------
# Backends
# ---------------------------------------------------------------------------


class EngineBackend:
    """A loaded model that can turn chat messages into text.

    `generate` yields ``(kind, text)`` pairs where ``kind`` is either
    ``"content"`` (the answer) or ``"reasoning"`` (the model's thinking).
    """

    def __init__(self, model_path: str, model_id: str, threads: int, ctx_size: int):
        self.model_path = model_path
        self.model_id = model_id
        self.threads = threads
        self.ctx_size = ctx_size
        self._lock = threading.Lock()

    def generate(
        self, messages: Sequence[dict[str, Any]], params: dict[str, Any]
    ) -> Iterator[tuple[str, str]]:
        raise NotImplementedError

    def close(self) -> None:
        pass

    def token_count(self, text: str) -> int:
        return 0


class LiteRtLmBackend(EngineBackend):
    """Google LiteRT-LM.

    The model is a single ``.task`` (or ``.litertlm``) bundle that carries the
    weights and the chat template. ``litert_lm.Engine`` owns the runtime; a
    ``Conversation`` renders the prompt and drives decoding.
    """

    def __init__(self, model_path: str, model_id: str, threads: int, ctx_size: int):
        super().__init__(model_path, model_id, threads, ctx_size)
        import litert_lm  # imported lazily so --help works without the runtime
        from litert_lm import interfaces as litert_interfaces

        self._litert_lm = litert_lm
        self._engine = litert_lm.Engine(
            model_path,
            backend=litert_interfaces.CPU(
                thread_count=threads if threads > 0 else None
            ),
            max_num_tokens=ctx_size,
        )

    def _message_text(self, message: Any) -> str:
        contents = getattr(message, "contents", None)
        if contents is None:
            return str(message)
        parts = []
        for item in contents:
            text = getattr(item, "text", None)
            parts.append(text if text is not None else str(item))
        return "".join(parts)

    def _thinking_text(self, message: Any) -> str:
        """Reasoning the model produced before the answer.

        LiteRT-LM carries it in the message's `thought` channel; reasoning
        models (Qwen3 and friends) spend their first tokens there.
        """
        channels = getattr(message, "channels", None) or {}
        return "".join(str(value) for value in channels.values())

    def generate(
        self, messages: Sequence[dict[str, Any]], params: dict[str, Any]
    ) -> Iterator[tuple[str, str]]:
        max_output_tokens = int(params.get("max_tokens") or 0) or None
        # The conversation renders the model's own chat template, so the whole
        # history is handed over as the preface and the last turn is the
        # message that gets answered.
        history = [dict(m) for m in messages[:-1]]
        last = dict(messages[-1])

        conversation = self._engine.create_conversation(
            messages=history,
            max_output_tokens=max_output_tokens,
        )
        try:
            for chunk in conversation.send_message_async(last):
                thinking = self._thinking_text(chunk)
                if thinking:
                    yield ("reasoning", thinking)
                text = self._message_text(chunk)
                if text:
                    yield ("content", text)
        finally:
            conversation.close()

    def token_count(self, text: str) -> int:
        try:
            return len(self._engine.tokenize(text))
        except Exception:  # tokenization is best-effort
            return 0


class OpenVinoBackend(EngineBackend):
    """Intel OpenVINO GenAI.

    The model is a directory holding the IR (``openvino_model.xml`` + ``.bin``)
    and the tokenizer. ``openvino_genai.LLMPipeline`` owns the compiled model.
    """

    def __init__(self, model_path: str, model_id: str, threads: int, ctx_size: int):
        super().__init__(model_path, model_id, threads, ctx_size)
        import openvino_genai as ov  # imported lazily

        device = os.environ.get("JAN_OPENVINO_DEVICE", "CPU")
        self._ov = ov
        self._pipeline = ov.LLMPipeline(model_path, device=device)
        self._tokenizer = self._pipeline.get_tokenizer()
        # One compiled pipeline serves one generation at a time. Two requests
        # that overlap (a chat and the thread-title summarizer, say) would
        # otherwise interleave their tokens and each answer would come out as
        # fragments of both.
        self._lock = threading.Lock()

    def _apply_generation_config(self, params: dict[str, Any]) -> None:
        """Applies the request's sampling parameters to the pipeline."""
        wanted: dict[str, Any] = {}
        temperature = params.get("temperature")
        top_p = params.get("top_p")
        if temperature is not None:
            wanted["do_sample"] = True
            wanted["temperature"] = float(temperature)
        if top_p is not None:
            wanted["do_sample"] = True
            wanted["top_p"] = float(top_p)
        if not wanted:
            return
        try:
            self._pipeline.set_generation_config(self._ov.GenerationConfig(**wanted))
        except Exception as exc:
            print(
                f"[jan-engine] could not apply the generation config: {exc}",
                file=sys.stderr,
                flush=True,
            )

    def generate(
        self, messages: Sequence[dict[str, Any]], params: dict[str, Any]
    ) -> Iterator[tuple[str, str]]:
        max_new_tokens = int(params.get("max_tokens") or 0) or 256
        prompt = self._tokenizer.apply_chat_template(
            [dict(m) for m in messages], add_generation_prompt=True
        )

        chunks: "queue.Queue[tuple[str, str] | None]" = queue.Queue()
        self._chunks = chunks
        streamed: list[str] = []

        def streamer(token: Any) -> None:
            text = token
            if isinstance(token, bytes):
                text = text.decode("utf-8", errors="replace")
            if text:
                streamed.append(text)
                chunks.put(("content", text))
            # The return value is NOT a continue/stop flag: returning True
            # ends the generation after this token, which is how the answer
            # used to arrive two words long. None keeps it going.

        # One compiled pipeline runs one generation at a time. Two requests
        # that overlap -- a chat and the thread-title summarizer, say --
        # would otherwise interleave their tokens, and each answer would come
        # out as fragments of both.
        def worker() -> None:
            try:
                with self._lock:
                    self._apply_generation_config(params)
                    result = self._pipeline.generate(
                        prompt, max_new_tokens=max_new_tokens, streamer=streamer
                    )
                # The streamer reports every token, so the text it produced
                # is the whole answer. What generate() returns is the same
                # text; if it is longer, send the difference so that nothing
                # is lost.
                full = result if isinstance(result, str) else ""
                joined = "".join(streamed)
                if full.startswith(joined):
                    remainder = full[len(joined):]
                elif not joined:
                    remainder = full
                else:
                    remainder = ""
                if remainder:
                    chunks.put(("content", remainder))
            except Exception as exc:
                print(
                    f"[jan-engine] openvino generate failed: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
            finally:
                chunks.put(None)

        thread = threading.Thread(target=worker, daemon=True)
        thread.start()
        try:
            while True:
                item = chunks.get()
                if item is None:
                    break
                yield item
        finally:
            self._chunks = None
            thread.join(timeout=30)

    def token_count(self, text: str) -> int:
        try:
            return len(self._tokenizer.encode(text).input_ids)
        except Exception:
            return 0


def create_backend(engine: str, args: argparse.Namespace) -> EngineBackend:
    if engine == "litert-lm":
        return LiteRtLmBackend(
            args.model, args.model_id, args.threads, args.ctx_size
        )
    if engine == "openvino":
        return OpenVinoBackend(args.model, args.model_id, args.threads, args.ctx_size)
    raise ValueError(f"Unknown engine: {engine}")


# ---------------------------------------------------------------------------
# HTTP layer
# ---------------------------------------------------------------------------


class EngineRequestHandler(BaseHTTPRequestHandler):
    server_version = "JanLocalEngine/1.0"
    protocol_version = "HTTP/1.1"

    # Set by serve().
    backend: EngineBackend
    api_key: str | None

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[jan-engine] {fmt % args}", file=sys.stderr, flush=True)

    # -- helpers ----------------------------------------------------------
    def _authorized(self) -> bool:
        if not self.api_key:
            return True
        header = self.headers.get("Authorization", "")
        if header.startswith("Bearer "):
            return header[len("Bearer ") :].strip() == self.api_key
        return self.headers.get("x-api-key", "").strip() == self.api_key

    def _send_json(self, payload: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        # Some clients (and Windows editors) prefix the payload with a UTF-8
        # BOM, which json.loads rejects.
        text = raw.decode("utf-8-sig", errors="replace")
        try:
            parsed = json.loads(text)
        except ValueError as exc:
            raise ValueError(f"invalid JSON body: {exc}") from exc
        if not isinstance(parsed, dict):
            raise ValueError("request body must be a JSON object")
        return parsed

    # -- routes -----------------------------------------------------------
    def do_GET(self) -> None:  # noqa: N802 - stdlib naming
        if self.path.startswith("/health"):
            self._send_json({"status": "ok", "model": self.backend.model_id})
            return
        if self.path.startswith("/v1/models"):
            if not self._authorized():
                self._send_json({"error": {"message": "Invalid API key"}}, 401)
                return
            self._send_json(
                {
                    "object": "list",
                    "data": [
                        {
                            "id": self.backend.model_id,
                            "object": "model",
                            "created": int(time.time()),
                            "owned_by": "local",
                        }
                    ],
                }
            )
            return
        self._send_json({"error": {"message": "Not found"}}, 404)

    def do_POST(self) -> None:  # noqa: N802 - stdlib naming
        if not self.path.startswith("/v1/chat/completions") and not self.path.startswith(
            "/v1/completions"
        ):
            self._send_json({"error": {"message": "Not found"}}, 404)
            return
        if not self._authorized():
            self._send_json({"error": {"message": "Invalid API key"}}, 401)
            return

        try:
            body = self._read_body()
        except ValueError as exc:
            self._send_json({"error": {"message": str(exc)}}, 400)
            return
        messages = body.get("messages")
        if not messages:
            messages = []
            prompt = body.get("prompt")
            if prompt:
                messages = [{"role": "user", "content": prompt}]
        if not messages:
            self._send_json(
                {"error": {"message": "messages is required"}}, 400
            )
            return

        params = {
            "max_tokens": body.get("max_tokens"),
            "temperature": body.get("temperature"),
            "top_p": body.get("top_p"),
        }
        stream = bool(body.get("stream"))
        model_id = body.get("model") or self.backend.model_id
        completion_id = f"chatcmpl-{uuid.uuid4().hex}"

        if not stream:
            try:
                content: list[str] = []
                reasoning: list[str] = []
                for kind, piece in self.backend.generate(messages, params):
                    if kind == "reasoning":
                        reasoning.append(piece)
                    else:
                        content.append(piece)
            except Exception as exc:
                self._send_json(
                    {"error": {"message": str(exc), "type": type(exc).__name__}}, 500
                )
                return
            message: dict[str, Any] = {
                "role": "assistant",
                "content": "".join(content),
            }
            if reasoning:
                message["reasoning_content"] = "".join(reasoning)
            self._send_json(
                {
                    "id": completion_id,
                    "object": "chat.completion",
                    "created": int(time.time()),
                    "model": model_id,
                    "choices": [
                        {
                            "index": 0,
                            "message": message,
                            "finish_reason": "stop",
                        }
                    ],
                }
            )
            return

        # Streaming: OpenAI-style server-sent events.
        #
        # The body has no known length, so it is sent with chunked transfer
        # encoding: a client that reads until the terminating chunk sees a
        # clean end of stream instead of a truncated body.
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()

        def chunk(delta: dict[str, Any], finish: str | None = None) -> bytes:
            payload = {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": int(time.time()),
                "model": model_id,
                "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
            }
            return f"data: {json.dumps(payload)}\n\n".encode()

        def write_chunked(data: bytes) -> None:
            self.wfile.write(f"{len(data):X}\r\n".encode())
            self.wfile.write(data)
            self.wfile.write(b"\r\n")
            self.wfile.flush()

        try:
            write_chunked(chunk({"role": "assistant", "content": ""}))
            for kind, piece in self.backend.generate(messages, params):
                delta = (
                    {"reasoning_content": piece}
                    if kind == "reasoning"
                    else {"content": piece}
                )
                write_chunked(chunk(delta))
            write_chunked(chunk({}, "stop"))
            write_chunked(b"data: [DONE]\n\n")
            # The terminating chunk.
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            # The client aborted the request; stop generating.
            pass
        except Exception as exc:
            try:
                payload = {
                    "error": {"message": str(exc), "type": type(exc).__name__}
                }
                self.wfile.write(f"data: {json.dumps(payload)}\n\n".encode())
                self.wfile.flush()
            except Exception:
                pass


def serve(args: argparse.Namespace) -> int:
    try:
        backend = create_backend(args.engine, args)
    except ImportError as exc:
        print(
            f"[jan-engine] runtime for '{args.engine}' is not installed: {exc}",
            file=sys.stderr,
            flush=True,
        )
        return 3
    except Exception as exc:
        print(f"[jan-engine] failed to load model: {exc}", file=sys.stderr, flush=True)
        return 4

    handler = type(
        "BoundHandler",
        (EngineRequestHandler,),
        {"backend": backend, "api_key": args.api_key},
    )
    httpd = ThreadingHTTPServer((args.host, args.port), handler)
    print(
        f"[jan-engine] {args.engine} serving {args.model_id} on "
        f"http://{args.host}:{args.port}",
        file=sys.stderr,
        flush=True,
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        backend.close()
        httpd.server_close()
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--engine",
        required=True,
        choices=["litert-lm", "openvino"],
        help="which runtime to load the model with",
    )
    parser.add_argument("--model", required=True, help="model file or directory")
    parser.add_argument("--model-id", default="local-model", help="id reported by /v1/models")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9379)
    parser.add_argument("--api-key", default=None)
    parser.add_argument("--threads", type=int, default=0, help="0 lets the runtime decide")
    parser.add_argument("--ctx-size", type=int, default=4096)
    args = parser.parse_args(argv)
    return serve(args)


if __name__ == "__main__":
    sys.exit(main())
