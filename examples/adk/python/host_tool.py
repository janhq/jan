"""Give Jan Agent a tool that your Python code executes.

Declares `get_weather` with `--host-tools`, checks the run advertised it,
approves the permission prompt for it (the run is started with `--safe`, so
your code decides every side effect), runs it when the model calls it, and
sends the result back. Everything travels over the stream-json channel of
`jan cli agent run`. Standard library only.

    python3 host_tool.py "What's the weather in Hanoi?"

Set JAN_BIN to use a jan binary that is not on PATH, and JAN_MODEL to pick a model.
"""

import json
import os
import subprocess
import sys
import tempfile

JAN = os.environ.get("JAN_BIN", "jan")

# What the model sees, as `host__get_weather`. Jan validates the declaration
# before the run starts; the arguments are validated by your code, below.
TOOLS = [
    {
        "name": "get_weather",
        "description": "Current weather for a city.",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
            "additionalProperties": False,
        },
    }
]


def get_weather(args: dict) -> dict:
    if not isinstance(args.get("city"), str):
        raise ValueError("'city' must be a string")
    return {"city": args["city"], "forecast": "sunny", "celsius": 21}


HANDLERS = {"get_weather": get_weather}


def main() -> int:
    task = sys.argv[1] if len(sys.argv) > 1 else "What's the weather in Hanoi? Use the get_weather tool."
    with tempfile.TemporaryDirectory() as scratch:
        project = os.path.join(scratch, "project")
        os.mkdir(project)
        tools_file = os.path.join(scratch, "host-tools.json")
        with open(tools_file, "w") as f:
            json.dump(TOOLS, f)

        cmd = [
            JAN, "cli", "agent", "run",
            "--project", project,
            "--safe",
            "--output-format", "stream-json",
            "--input-format", "stream-json",
            "--host-tools", tools_file,
        ]
        if os.environ.get("JAN_MODEL"):
            cmd += ["--model", os.environ["JAN_MODEL"]]
        cmd.append(task)

        run = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)

        def send(message: dict) -> None:
            run.stdin.write(json.dumps(message) + "\n")
            run.stdin.flush()

        result = None
        for line in run.stdout:
            record = json.loads(line)
            kind = record["type"]
            if kind == "init":
                # A declared tool missing here was withheld by policy (deny
                # list, plan mode) and will never be called.
                advertised = {spec["function"]["name"] for spec in record.get("tool_specs", [])}
                missing = {f"host__{t['name']}" for t in TOOLS} - advertised
                if missing:
                    print(f"withheld by policy: {sorted(missing)}", file=sys.stderr)
            elif kind == "permission_request":
                # Under `--safe` a host tool is prompted like an MCP tool, and
                # so are writes and shell commands. Approve ours; refuse the rest.
                ours = record["tool_name"].startswith("host__")
                send({
                    "type": "permission",
                    "request_id": record["request_id"],
                    "decision": "allow_once" if ours else "deny",
                })
            elif kind == "tool_request":
                # `tool_name` is the name declared above, without `host__`.
                handler = HANDLERS.get(record["tool_name"])
                try:
                    if handler is None:
                        raise KeyError(f"no handler for {record['tool_name']}")
                    content, is_error = json.dumps(handler(record["args"])), False
                except Exception as error:  # the model sees this as the tool's error
                    content, is_error = f"{type(error).__name__}: {error}", True
                print(f"\n[{record['tool_name']}({json.dumps(record['args'])}) -> {content}]", file=sys.stderr)
                send({
                    "type": "tool_result",
                    "request_id": record["request_id"],
                    "content": content,
                    "is_error": is_error,
                })
            elif kind == "token":
                print(record["text"], end="", flush=True)
            elif kind == "result":
                result = record
        run.stdin.close()
        run.wait()

    print()
    if result is None:
        print(f"jan exited with {run.returncode} before printing a result", file=sys.stderr)
        return 1
    if result["is_error"]:
        print(f"run failed: {result['error']['code']}: {result['error']['message']}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
