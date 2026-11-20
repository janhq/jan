"""Validate the collector's JSON lines against the Claude Code-compatible
names jan emits. Exit 1 listing every gap."""
import json, sys

want_metrics = {"jan_agent.session.count", "jan_agent.prompt.count", "jan_agent.turn.count",
                "jan_agent.api_request.count", "jan_agent.token.usage", "jan_agent.tool.count",
                "jan_agent.active_time.total"}
want_events = {"jan_agent.user_prompt": ["session.id", "prompt.id", "prompt_length"],
               "jan_agent.api_request": ["session.id", "prompt.id", "model", "input_tokens", "output_tokens"],
               "jan_agent.tool_decision": ["tool_name", "decision", "source"],
               "jan_agent.tool_result": ["tool_name", "success", "duration_ms"]}
want_spans = {"jan_agent.interaction": ["session.id", "prompt.id", "user_prompt_length", "interaction.sequence"],
              "jan_agent.llm_request": ["gen_ai.request.model", "gen_ai.usage.input_tokens", "gen_ai.usage.output_tokens"],
              "jan_agent.tool": ["tool_name", "tool_use_id", "success"]}

metrics, events, spans = set(), {}, []
for line in open(sys.argv[1]):
    doc = json.loads(line)
    for rm in doc.get("resourceMetrics", []):
        for sm in rm["scopeMetrics"]:
            metrics |= {m["name"] for m in sm["metrics"]}
    for rl in doc.get("resourceLogs", []):
        for sl in rl["scopeLogs"]:
            for r in sl["logRecords"]:
                events.setdefault(r.get("eventName"), []).append({a["key"] for a in r.get("attributes", [])})
    for rs in doc.get("resourceSpans", []):
        for ss in rs["scopeSpans"]:
            spans += ss["spans"]

gaps = [f"metric {m}" for m in sorted(want_metrics - metrics)]
for name, keys in want_events.items():
    got = events.get(name)
    if not got:
        gaps.append(f"event {name}")
    else:
        gaps += [f"event {name}.{k}" for k in keys if not any(k in g for g in got)]
by_name = {}
for s in spans:
    by_name.setdefault(s["name"], []).append(s)
for name, keys in want_spans.items():
    got = by_name.get(name)
    if not got:
        gaps.append(f"span {name}")
        continue
    for k in keys:
        if not any(k in {a["key"] for a in s["attributes"]} for s in got):
            gaps.append(f"span {name}.{k}")
roots = by_name.get("jan_agent.interaction", [])
for s in spans:
    if s["name"] != "jan_agent.interaction" and not any(
            s["traceId"] == r["traceId"] and s.get("parentSpanId") == r["spanId"] for r in roots):
        gaps.append(f"span {s['name']} {s['spanId']} is not under an interaction")
print(f"metrics={len(metrics)} events={sum(map(len, events.values()))} spans={len(spans)}")
if gaps:
    print("GAPS:\n  " + "\n  ".join(gaps))
    sys.exit(1)
print("OK: Claude Code-compatible metrics, events and span tree present")
