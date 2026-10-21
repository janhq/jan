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
import io
import json
import os
import queue
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Iterator, Sequence

# A chat body carries the whole transcript, images included, on every turn. The
# cap is generous for text and small enough that a runaway client cannot make
# the sidecar allocate an arbitrary buffer: one request holds the raw bytes,
# the decoded JSON and the parsed object at once.
MAX_BODY_BYTES = 16 * 1024 * 1024


class BodyTooLarge(ValueError):
    """A request whose declared length exceeds `MAX_BODY_BYTES`."""

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

        # One engine, one conversation at a time. `openvino` already serializes;
        # without the same lock here, a chat turn and the thread-title
        # summarizer could each create a conversation and a KV cache against
        # one Engine, doubling the allocation at up to `ctx_size` each.
        # Holding the lock across the yield loop also makes an aborted request
        # release it promptly, when the handler closes this generator.
        with self._lock:
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
        # Apply the configured window to the pipeline itself. Without it the
        # pipeline runs at the model's own maximum no matter what the UI says,
        # so the token meter warns about a 4k window while the KV cache grows
        # to the model's trained context. The property names have moved between
        # OpenVINO releases, so a runtime that rejects them still works: the
        # per-request `max_length` and prompt fit below are the fallback.
        properties: dict[str, Any] = {}
        if ctx_size > 0:
            reserve = max(64, min(512, ctx_size // 8))
            properties = {
                "MAX_PROMPT_LEN": max(128, ctx_size - reserve),
                "MIN_RESPONSE_LEN": reserve,
            }
        try:
            self._pipeline = ov.LLMPipeline(
                model_path, device=device, **properties
            )
        except Exception as exc:
            print(
                f"[jan-engine] the runtime rejected the context properties "
                f"({exc}); falling back to its own window",
                file=sys.stderr,
                flush=True,
            )
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
        if self.ctx_size > 0:
            # Total prompt + answer, so a long prompt cannot grow the KV cache
            # past the window the user (and the token meter) believes in.
            wanted["max_length"] = self.ctx_size
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
            config = self._ov.GenerationConfig(**wanted)
        except Exception:
            # An older runtime without `max_length`: keep sampling, drop the cap
            # (the pipeline properties and prompt fit are still in force).
            wanted.pop("max_length", None)
            if not wanted:
                return
            config = self._ov.GenerationConfig(**wanted)
        try:
            self._pipeline.set_generation_config(config)
        except Exception as exc:
            print(
                f"[jan-engine] could not apply the generation config: {exc}",
                file=sys.stderr,
                flush=True,
            )

    def _fit_prompt(self, prompt: str, max_new_tokens: int) -> str:
        """Truncates the rendered prompt to the configured window.

        Keeps the tail, which holds the chat template's generation prompt and
        the most recent turns; dropping the oldest text is what the model would
        have to do anyway at its limit. Best effort: a tokenizer that does not
        expose `encode`/`decode` as expected leaves the prompt alone rather than
        failing the request.
        """
        if self.ctx_size <= 0:
            return prompt
        budget = max(1, self.ctx_size - max_new_tokens)
        try:
            encoded = self._tokenizer.encode(prompt)
            ids = encoded.input_ids
            values = list(ids.data) if hasattr(ids, "data") else list(ids)
            if len(values) <= budget:
                return prompt
            trimmed = self._tokenizer.decode(values[-budget:])
            print(
                f"[jan-engine] prompt was {len(values)} tokens, trimmed to "
                f"{budget} to fit the {self.ctx_size}-token window",
                file=sys.stderr,
                flush=True,
            )
            return trimmed if isinstance(trimmed, str) else prompt
        except Exception:
            return prompt

    def generate(
        self, messages: Sequence[dict[str, Any]], params: dict[str, Any]
    ) -> Iterator[tuple[str, str]]:
        max_new_tokens = int(params.get("max_tokens") or 0) or 256
        if self.ctx_size > 0:
            max_new_tokens = min(max_new_tokens, max(1, self.ctx_size - 1))
        prompt = self._tokenizer.apply_chat_template(
            [dict(m) for m in messages], add_generation_prompt=True
        )
        prompt = self._fit_prompt(prompt, max_new_tokens)

        # Bounded, so a client that stops reading cannot let the generator run
        # ahead and pile the whole answer up in memory.
        chunks: "queue.Queue[tuple[str, str] | None]" = queue.Queue(maxsize=64)
        # Set when the consumer goes away (Stop, a dropped connection) or the
        # generator is closed; the worker stops at the next token instead of
        # generating to `max_new_tokens` for nobody.
        cancelled = threading.Event()
        # Running length, not a list of every token: the joined string was the
        # answer copied a second time, and the result a third.
        streamed_len = 0

        def put(item: "tuple[str, str] | None") -> bool:
            while not cancelled.is_set():
                try:
                    chunks.put(item, timeout=0.1)
                    return True
                except queue.Full:
                    continue
            return False

        def streamer(token: Any) -> Any:
            nonlocal streamed_len
            if cancelled.is_set():
                # Returning True ends the generation after this token.
                return True
            text = token
            if isinstance(token, bytes):
                text = text.decode("utf-8", errors="replace")
            if text:
                streamed_len += len(text)
                if not put(("content", text)):
                    return True
            # The return value is NOT a continue/stop flag: returning True
            # ends the generation after this token, which is how the answer
            # used to arrive two words long. None keeps it going.
            return None

        # One compiled pipeline runs one generation at a time. Two requests
        # that overlap -- a chat and the thread-title summarizer, say --
        # would otherwise interleave their tokens, and each answer would come
        # out as fragments of both.
        def worker() -> None:
            try:
                with self._lock:
                    if cancelled.is_set():
                        return
                    self._apply_generation_config(params)
                    result = self._pipeline.generate(
                        prompt, max_new_tokens=max_new_tokens, streamer=streamer
                    )
                # The streamer reports every token, so its count is the length
                # of what the client already has. If `generate` also returns
                # text, send only the part beyond that count.
                full = result if isinstance(result, str) else ""
                if full and len(full) > streamed_len:
                    put(("content", full[streamed_len:]))
            except Exception as exc:
                print(
                    f"[jan-engine] openvino generate failed: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
            finally:
                put(None)

        thread = threading.Thread(target=worker, daemon=True)
        thread.start()
        try:
            while True:
                item = chunks.get()
                if item is None:
                    break
                yield item
        finally:
            cancelled.set()
            # Drop anything the worker had queued; the consumer is gone.
            try:
                while True:
                    chunks.get_nowait()
            except queue.Empty:
                pass
            thread.join(timeout=5)

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
        if length > MAX_BODY_BYTES:
            # Do not read it: reading first is the allocation this cap exists
            # to prevent. The connection is closed because the unread body
            # would otherwise be parsed as the next request.
            self.close_connection = True
            raise BodyTooLarge(
                f"request body is {length} bytes; the limit is {MAX_BODY_BYTES}"
            )
        raw = self.rfile.read(length)
        # Parse the bytes directly: `json.loads` detects UTF-8/UTF-16 and a
        # UTF-8 BOM on its own, so the body is not decoded into a second copy
        # first. A chat body carries the whole transcript, images included.
        try:
            parsed = json.loads(raw)
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
        except BodyTooLarge as exc:
            self._send_json({"error": {"message": str(exc)}}, 413)
            return
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
            # One buffer each, rather than a list of every token plus a join:
            # a buffered answer used to be held twice before it was sent.
            content = io.StringIO()
            reasoning = io.StringIO()
            generator = self.backend.generate(messages, params)
            try:
                for kind, piece in generator:
                    if kind == "reasoning":
                        reasoning.write(piece)
                    else:
                        content.write(piece)
            except Exception as exc:
                self._send_json(
                    {"error": {"message": str(exc), "type": type(exc).__name__}}, 500
                )
                return
            finally:
                # Release the engine lock (and the conversation / worker) even
                # when the client is gone or the backend raised.
                generator.close()
            message: dict[str, Any] = {
                "role": "assistant",
                "content": content.getvalue(),
            }
            reasoning_text = reasoning.getvalue()
            if reasoning_text:
                message["reasoning_content"] = reasoning_text
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

        generator = self.backend.generate(messages, params)
        try:
            write_chunked(chunk({"role": "assistant", "content": ""}))
            for kind, piece in generator:
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
            # The client aborted the request. Closing the generator cancels the
            # generation -- and, for OpenVINO, releases the engine lock -- in
            # its own `finally`; without this it ran to `max_new_tokens` while
            # the next request waited behind it.
            self.close_connection = True
        except Exception as exc:
            try:
                payload = {
                    "error": {"message": str(exc), "type": type(exc).__name__}
                }
                self.wfile.write(f"data: {json.dumps(payload)}\n\n".encode())
                self.wfile.flush()
            except Exception:
                pass
        finally:
            generator.close()


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
