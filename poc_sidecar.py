import json, sys, copy, hashlib, time, os
from pathlib import Path

# 1. 加载人工定义的契约（锚定到脚本目录，守护进程不受 cwd 影响）
SCHEMA_PATH = Path(__file__).resolve().parent / "contracts" / "permission-schema.json"
SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))

# 2. journal 配置（append-only 事件流，落盘、按 request_id 关联；绝不入 git）
BASE = Path(__file__).resolve().parent
JOURNAL_DIR = BASE / "journal"
JOURNAL_FILE = JOURNAL_DIR / "events.jsonl"
LOCK_FILE = JOURNAL_DIR / "events.jsonl.lock"  # 锁文件与数据文件分离，避免同进程重开被锁文件
RECONCILE_TTL = 60.0  # 秒

# Windows 原生文件锁（无第三方依赖）
import msvcrt


def check_permission(tool_name, params):
    """Sidecar 权限门逻辑，返回 (verdict, message)。

    verdict ∈ {"ALLOW", "DENY", "DEFER"}
    - DENY: 高风险，或 schema 未定义的未知工具（fail-closed：未知即默认拒绝）
    - DEFER: 副作用型工具（requires_commit），预留给两阶段 commit 阶段接入
    - ALLOW: 普通受管工具
    """
    tool_def = SCHEMA["tools"].get(tool_name)
    if not tool_def:
        # 安全铁律：未知即默认拒绝。schema 未定义的工具名一律拦截，
        # 防止 schema 被篡改、或 agent 生成未定义的高危工具名绕过总闸。
        return "DENY", "unlisted tool not in contract"
    # 高风险直接拦截
    deny_above = SCHEMA.get("gate", {}).get("deny_risk_above", 3)
    if tool_def["risk"] > deny_above:
        return "DENY", f"Risk too high ({tool_def['risk']})"
    # 副作用型工具：预留 DEFER，两阶段 commit 阶段再接入（先记账后落地）
    if tool_def.get("requires_commit"):
        return "DEFER", "side-effect tool; two-phase commit pending"
    return "ALLOW", "Permission granted"


def fork_and_rollback(state_snapshot, action_func):
    """Fork 回滚 POC 演示"""
    print(f"[Sidecar] Current state: {state_snapshot}")
    snapshot = copy.deepcopy(state_snapshot)  # Fork 内存状态
    try:
        # 模拟执行副作用操作
        action_func(snapshot)
        print(f"[Sidecar] Action success, new state: {snapshot}")
        return snapshot  # 两阶段 commit 第一阶段成功
    except Exception as e:
        print(f"[Sidecar] Action failed: {e}, Rolling back to {state_snapshot}")
        return state_snapshot  # 直接丢弃 fork，回滚


# ---------- Windows 原生文件锁（无第三方依赖） ----------
class _FileLock:
    def __init__(self, path):
        self.path = path
        self.fh = None
    def __enter__(self):
        JOURNAL_DIR.mkdir(parents=True, exist_ok=True)
        # 独占打开：写入 + 允许并发读
        self.fh = open(self.path, "a+b")
        msvcrt.locking(self.fh.fileno(), msvcrt.LK_LOCK, 1)  # 阻塞重试式锁定
        return self
    def __exit__(self, *exc):
        try:
            self.fh.seek(0)
            msvcrt.locking(self.fh.fileno(), msvcrt.LK_UNLCK, 1)
        finally:
            self.fh.close()


def _sha256(obj):
    return hashlib.sha256(
        json.dumps(obj, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def _append_event(evt):
    # 数据安全：只落 request_id / tool / params_sha256 / path，绝不落写入内容
    with _FileLock(LOCK_FILE):
        with open(JOURNAL_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(evt, ensure_ascii=False) + "\n")
            f.flush()
            os.fsync(f.fileno())


def _read_events():
    if not JOURNAL_FILE.exists():
        return []
    out = []
    with open(JOURNAL_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue  # 坏行直接跳过，不炸整个账本
    return out


def _reconcile():
    """sidecar 首次被拉起时跑一次：超 TTL 仍是 open 的孤儿 -> orphan_reconciled。
    - staging 孤儿（write/edit）：真实 target 还没被替换，删掉 .taiji-staging 即清场。
    - ledger 孤儿（其余 DEFER）：字节已直接落到 target，撤不回，只标状态（J 诚实语义）。
    - B phase (N2)：.bak 残留检测——发现遗留 .bak 即判定该 turn commit 未完成，
      用 .bak 恢复 target 真值并清 staging。
    """
    now = time.time()
    with _FileLock(LOCK_FILE):
        events = _read_events()
        # 每个 request_id 的最后一条事件 + 它的 open 时间/mode/path/staging
        last = {}
        open_ts = {}
        open_mode = {}
        open_path = {}
        open_staging = {}
        for e in events:
            rid = e.get("request_id")
            if not rid:
                continue
            last[rid] = e.get("phase")
            if e.get("phase") == "open":
                open_ts[rid] = e.get("ts", now)
                open_mode[rid] = e.get("mode", "ledger")
                open_path[rid] = e.get("path", "")
                open_staging[rid] = e.get("staging") or ((e.get("path") or "") + ".taiji-staging")
        orphans = [
            rid for rid, ph in last.items()
            if ph == "open" and (now - open_ts.get(rid, now)) > RECONCILE_TTL
        ]
        if orphans:
            with open(JOURNAL_FILE, "a", encoding="utf-8") as f:
                for rid in orphans:
                    if open_mode.get(rid) == "staging":
                        # staging 孤儿：target 没被替换过，直接删 staging 文件（用事件里的唯一 staging）
                        staging = open_staging.get(rid) or ""
                        try:
                            os.remove(staging)
                        except OSError:
                            pass
                    f.write(json.dumps({
                        "phase": "orphan_reconciled",
                        "request_id": rid,
                        "mode": open_mode.get(rid, "ledger"),
                        "ts": now,
                    }, ensure_ascii=False) + "\n")

        # B phase：.bak 残留检测（N2 批中途崩溃 reconcile）
        for rid in list(last.keys()):
            path = open_path.get(rid, "")
            bak = path + ".taiji-bak." + rid if path else ""
            if bak and os.path.exists(bak):
                # 发现遗留 .bak：判定该 turn commit 未完成，用 .bak 恢复 target
                try:
                    if os.path.exists(path):
                        # target 存在（可能被部分替换），用 .bak 覆盖
                        os.replace(bak, path)
                        print(f"[cplus] reconcile: restored {path} from {bak}", file=sys.stderr)
                    else:
                        # target 不存在（新文件 write 中途崩溃），删 .bak 即可
                        os.remove(bak)
                        print(f"[cplus] reconcile: removed orphan bak {bak}", file=sys.stderr)
                except OSError as ex:
                    print(f"[cplus] reconcile: failed to handle bak {bak}: {ex}", file=sys.stderr)
                # 同时清理 staging
                staging = open_staging.get(rid) or ""
                if staging:
                    try:
                        os.remove(staging)
                    except OSError:
                        pass
    return len(orphans)


# ---------- 各 kind 处理器 ----------
def _handle_check(req):
    # 门禁/握手三态判定：直接透传 check_permission 的 ALLOW/DENY/DEFER，不做二次改写。
    # （修复：原补丁用 `ok, msg = check_permission(...)` 把三态字符串当 bool 判，
    #  会把 DENY 误判为 ALLOW —— 击穿验收⑥ bash 仍须 DENY。这里一步到位。）
    status, msg = check_permission(req.get("tool_name", ""), req.get("params", {}))
    return {"status": status, "message": msg, "request_id": req.get("request_id", "")}


def _handle_open(req):
    rid = req.get("request_id", "")
    tool = req.get("tool_name", "")
    params = req.get("params", {})
    # S (3.1/3.2) 影子写：write/edit 工具走 staging 模式，commit 时 os.replace 原子覆盖；
    # 其余 DEFER 工具暂留 J 账本模式（rollback 只回账本不撤字节）。
    # path 必须是绝对解析后的目标路径（Rust 侧已 resolve），commit 用 path+".taiji-staging.<rid>"。
    mode = "staging" if tool in ("write", "edit") else "ledger"
    abs_path = params.get("path") or params.get("file_path") or ""
    # 洞 B：staging 名以 rid 唯一化（Rust 侧已算好传进来），避免同 target 并发写互相覆盖
    staging_path = params.get("staging") or (abs_path + ".taiji-staging")
    evt = {
        "phase": "open", "request_id": rid, "tool": tool,
        "params_sha256": _sha256(params),
        "path": abs_path,
        "staging": staging_path,
        "mode": mode,
        "ts": time.time(),
    }
    try:
        _append_event(evt)
        if mode == "staging":
            return {"status": "STAGING_READY", "request_id": rid,
                    "staging_path": staging_path}
        return {"status": "DEFER", "request_id": rid}
    except Exception as e:
        # fail-closed 延伸：记账失败 = 门禁失败，交上游改判 DENY
        return {"status": "ERROR", "message": f"journal_open failed: {e}", "request_id": rid}


def _handle_finalize(req, phase):
    rid = req.get("request_id", "")
    now = time.time()
    try:
        # 反查该 rid 的 open 事件，取出 mode / path / staging（journal 是 append-only，顺序扫一遍）
        # staging 以事件里的字段为单一事实源（含 rid 唯一化），不再现算 path+".taiji-staging"
        mode = "ledger"
        path = ""
        staging = ""
        found_open = False
        for e in _read_events():
            if e.get("request_id") == rid and e.get("phase") == "open":
                found_open = True
                mode = e.get("mode", "ledger")
                path = e.get("path", "")
                staging = e.get("staging") or (path + ".taiji-staging")
        if phase == "commit" and not found_open:
            # fail-closed（与洞 A 同源）：commit 却找不到 open 事件（账本被清/轮转/异常），
            # 拿不准就报失败，绝不回 OK 假绿——否则会出现"target 从没 replace 却回 OK"。
            _append_event({"phase": "commit_failed", "request_id": rid,
                           "error": "open event not found", "ts": now})
            return {"status": "COMMIT_FAILED", "request_id": rid,
                    "message": "open event missing; refuse to claim commit"}
        if phase == "commit" and mode == "staging":
            try:
                # Windows 上 os.replace == MoveFileEx + REPLACE_EXISTING，同卷原子覆盖
                os.replace(staging, path)
                _append_event({"phase": "committed", "request_id": rid, "ts": now})
                return {"status": "OK", "request_id": rid}
            except Exception as e:
                # 洞 A：replace 失败必须显式回 COMMIT_FAILED（不再掩成 OK），并清理孤儿 staging
                try:
                    os.remove(staging)
                except OSError:
                    pass
                _append_event({"phase": "commit_failed", "request_id": rid,
                               "error": str(e), "ts": now})
                return {"status": "COMMIT_FAILED", "request_id": rid,
                        "message": f"os.replace failed: {e}"}
        elif phase == "note_commit":
            # B phase (N2)：turn 模式下 Rust 已独占完成 os.replace，只记账本 committed 事件。
            # NEW-1 修复：复用 found_open fail-closed——无 open 事件不记 committed（[I] 延伸）。
            if not found_open:
                _append_event({"phase": "commit_failed", "request_id": rid,
                               "error": "open event not found for note_commit", "ts": now})
                return {"status": "COMMIT_FAILED", "request_id": rid,
                        "message": "open event missing; refuse to claim note_commit"}
            _append_event({"phase": "committed", "request_id": rid, "ts": now})
            return {"status": "OK", "request_id": rid}
        elif phase == "rollback" and mode == "staging":
            try:
                # staging 还没替换到 target，删掉即可，target 字节不动
                os.remove(staging)
            except OSError:
                pass
            _append_event({"phase": "rolled_back", "request_id": rid, "ts": now})
            return {"status": "OK", "request_id": rid}
        else:
            # J 账本模式（edit 等）：只记账本，不碰字节；rollback 同理
            _append_event({"phase": phase, "request_id": rid, "ts": now})
            return {"status": "OK", "request_id": rid}
    except Exception as e:
        return {"status": "ERROR", "message": f"journal_{phase} failed: {e}", "request_id": rid}


_reconciled = False


def start_ipc_mode():
    """Stdio IPC 守护进程。按请求中的 kind 分流：
    - 缺省 / "check"      -> 权限三态裁决（ALLOW/DENY/DEFER）
    - "open"             -> 两阶段记账：write/edit 回 STAGING_READY（记绝对 target + mode），
                            其余 DEFER 工具回 DEFER；都追加 open 事件
    - "commit"/"rollback" -> 按 mode 分流：staging 走 os.replace / os.remove，ledger 只记账本
    账本 append-only、带文件锁、崩溃可重放；孤儿由 _reconcile 兜底。"""
    global _reconciled
    if not _reconciled:
        _reconcile()
        _reconciled = True

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            kind = req.get("kind", "check")
            if kind == "check":
                resp = _handle_check(req)
            elif kind == "open":
                resp = _handle_open(req)
            elif kind == "commit":
                resp = _handle_finalize(req, "commit")
            elif kind == "note_commit":
                # B phase (N2)：Rust 已独占 replace，只记账本 committed
                resp = _handle_finalize(req, "note_commit")
            elif kind == "rollback":
                resp = _handle_finalize(req, "rollback")
            else:
                resp = {"status": "ERROR", "message": f"unknown kind: {kind}",
                        "request_id": req.get("request_id", "")}
            print(json.dumps(resp, ensure_ascii=False), flush=True)
        except Exception as e:
            print(json.dumps({"status": "ERROR", "message": str(e), "request_id": ""},
                             ensure_ascii=False), flush=True)


if __name__ == "__main__":
    # 如果有 --daemon 参数，进入 IPC 模式，否则执行原有的本地 POC 测试
    if "--daemon" in sys.argv:
        start_ipc_mode()
    else:
        # 保留原来的本地测试逻辑，方便你随时验证逻辑
        initial_state = {"file_count": 1}

        def write_action(state):
            state["file_count"] += 1
            raise Exception("Simulated failure")

        final_state = fork_and_rollback(initial_state, write_action)
        print(f"Final state: {final_state}")
