// Wraps llama.cpp's own tests/test-backend-ops.cpp, unmodified, so the app can
// ask "does every ggml op run correctly on this device?" without a fork.
//
// The upstream file is one translation unit with a `static` driver and its own
// main(), so it cannot be linked -- it is #included here after renaming main.
// What this file adds is ours: a printer that emits JSON, and a driver that runs
// one device through upstream's `test_backend` (the same function its main()
// calls). A llama.cpp bump either still compiles against this or fails loudly.
//
// It needs ggml's headers only: no libllama and none of LLAMA_BUILD_COMMON.
//
// stdout and stderr stay clean. Upstream's per-case diagnostics ("[ADD] ERR =
// ...", "failed to allocate tensors") are bare printf/fprintf calls, not part
// of its printer interface; they are redirected into a per-thread buffer below
// and attached to the JSON event they belong to.

#include "jan_llama_shim.h"

#include "ggml.h"
#include "ggml-alloc.h"
#include "ggml-backend.h"
#include "ggml-cpp.h"

#include "nlohmann/json.hpp"

// Everything the upstream file includes, pulled in *before* printf is
// redefined: a standard header that mentions the token (libstdc++'s <cstdio>
// does, as `using ::printf`) would otherwise be mangled by the macro.
#include <algorithm>
#include <atomic>
#include <array>
#include <cfloat>
#include <cinttypes>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <future>
#include <fstream>
#include <map>
#include <memory>
#include <mutex>
#include <random>
#include <regex>
#include <set>
#include <sstream>
#include <string>
#include <string_view>
#include <thread>
#include <vector>
#include <unordered_map>

namespace {

// Text the upstream cases print while running. A case that fails prints its
// reason and then reports through the printer; the two always happen on the
// same thread, which is what makes a thread_local the right scope.
thread_local std::string t_noise;

// A failing run can print once per element of a large tensor on some paths.
constexpr size_t NOISE_CAP = 8 * 1024;

int noise_vprintf(const char * fmt, va_list ap) {
    va_list copy;
    va_copy(copy, ap);
    const int n = std::vsnprintf(nullptr, 0, fmt, copy);
    va_end(copy);
    if (n <= 0) {
        return n;
    }
    if (t_noise.size() < NOISE_CAP) {
        std::string piece(static_cast<size_t>(n) + 1, '\0');
        std::vsnprintf(&piece[0], piece.size(), fmt, ap);
        piece.resize(static_cast<size_t>(n));
        t_noise += piece;
    }
    return n;
}

int jan_diag_printf(const char * fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    const int n = noise_vprintf(fmt, ap);
    va_end(ap);
    return n;
}

// Upstream also writes to an arbitrary FILE * (its SQL printer's `fout`); only
// the two process streams are ours to capture.
int jan_diag_fprintf(FILE * f, const char * fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    int n;
    if (f == stdout || f == stderr) {
        n = noise_vprintf(fmt, ap);
    } else {
        n = std::vfprintf(f, fmt, ap);
    }
    va_end(ap);
    return n;
}

std::string take_noise() {
    std::string out = std::move(t_noise);
    t_noise.clear();
    while (!out.empty() && (out.back() == '\n' || out.back() == ' ')) {
        out.pop_back();
    }
    return out;
}

}  // namespace

#define main    jan_diag_upstream_main
#define printf  jan_diag_printf
#define fprintf jan_diag_fprintf
#include "tests/test-backend-ops.cpp"
#undef fprintf
#undef printf
#undef main

namespace {

using json = nlohmann::json;

struct json_printer : public printer {
    json_printer(jan_llama_diag_cb cb, void * user_data) : cb(cb), user_data(user_data) {}

    // The event sink. Cases run on several threads under -j; upstream
    // serialises print_test_result, but the other hooks are not guaranteed to
    // be, so the sink is.
    void emit(const json & j) {
        if (cb == nullptr) {
            return;
        }
        // Device descriptions are vendor strings; invalid UTF-8 must not make
        // dump() throw in the middle of a run.
        const std::string line = j.dump(-1, ' ', false, json::error_handler_t::replace);
        std::lock_guard<std::mutex> guard(emit_mutex);
        cb(line.c_str(), user_data);
    }

    void print_test_result(const test_result & r) override {
        const char * status = !r.supported ? "not_supported" : r.passed ? "ok" : "fail";
        std::string noise = take_noise();
        // Text left over from a case that printed a reason and then returned
        // without a result (an allocation failure does) must not be pinned on
        // the next case, so only a failing one takes it as its detail.
        if (!noise.empty() && std::strcmp(status, "fail") != 0) {
            emit({{"event", "log"}, {"text", noise}});
            noise.clear();
        }
        json j = {
            {"event", "result"},
            {"backend", r.backend_name},
            {"op", r.op_name},
            {"params", r.op_params},
            {"mode", r.test_mode},
            {"status", status},
        };
        // In support mode upstream reuses error_message for "yes"/"no", which
        // only restates the status and would read as a failure.
        if (!r.error_message.empty() && r.test_mode != "support") {
            j["error"] = r.error_message;
        }
        if (!noise.empty()) {
            j["detail"] = noise;
        }
        emit(j);
    }

    void print_operation(const test_operation_info & info) override {
        json j = {
            {"event", "operation"},
            {"op", info.op_name},
            {"params", info.op_params},
            {"backend", info.backend_name},
            {"status", status_str(info.status)},
        };
        if (!info.failure_reason.empty()) {
            j["reason"] = info.failure_reason;
        }
        if (info.has_error) {
            j["component"] = info.error_component;
            j["details"]   = info.error_details;
        }
        emit(j);
    }

    void print_summary(const test_summary_info & info) override {
        emit({{"event", "summary"}, {"passed", info.tests_passed}, {"total", info.tests_total}});
    }

    void print_testing_start(const testing_start_info & info) override {
        emit({{"event", "testing_start"}, {"devices", info.device_count}});
    }

    void print_backend_init(const backend_init_info & info) override {
        json j = {
            {"event", "backend_init"},
            {"index", info.device_index},
            {"total", info.total_devices},
            {"name", info.device_name},
            {"skipped", info.skipped},
        };
        if (info.skipped) {
            j["skip_reason"] = info.skip_reason;
        }
        if (!info.description.empty()) {
            j["description"] = info.description;
        }
        if (info.has_memory_info) {
            j["memory_total_mb"] = info.memory_total_mb;
            j["memory_free_mb"]  = info.memory_free_mb;
        }
        emit(j);
    }

    void print_backend_status(const backend_status_info & info) override {
        emit({{"event", "backend_status"}, {"backend", info.backend_name}, {"status", status_str(info.status)}});
    }

    void print_overall_summary(const overall_summary_info & info) override {
        emit({{"event", "overall_summary"},
              {"passed", info.backends_passed},
              {"total", info.backends_total},
              {"all_passed", info.all_passed}});
    }

    void print_failed_tests(const std::vector<std::string> & failed_tests) override {
        if (!failed_tests.empty()) {
            emit({{"event", "failed_tests"}, {"tests", failed_tests}});
        }
    }

    // Stream a trailing `log` for anything printed outside a case (upstream's
    // Metal-only slice run prints a header and per-case failures).
    void flush_noise() {
        const std::string noise = take_noise();
        if (!noise.empty()) {
            emit({{"event", "log"}, {"text", noise}});
        }
    }

  private:
    static const char * status_str(test_status_t s) {
        switch (s) {
            case test_status_t::OK:            return "ok";
            case test_status_t::FAIL:          return "fail";
            case test_status_t::NOT_SUPPORTED: return "not_supported";
            case test_status_t::SKIPPED:       return "skipped";
        }
        return "fail";
    }

    jan_llama_diag_cb cb;
    void *            user_data;
    std::mutex        emit_mutex;
};

void set_err(char * err, size_t err_len, const std::string & msg) {
    if (err == nullptr || err_len == 0) {
        return;
    }
    std::snprintf(err, err_len, "%s", msg.c_str());
}

char * dup_string(const std::string & s) {
    char * buf = static_cast<char *>(std::malloc(s.size() + 1));
    if (buf == nullptr) {
        return nullptr;
    }
    std::memcpy(buf, s.c_str(), s.size() + 1);
    return buf;
}

const char * device_type_str(enum ggml_backend_dev_type t) {
    switch (t) {
        case GGML_BACKEND_DEVICE_TYPE_CPU:   return "cpu";
        case GGML_BACKEND_DEVICE_TYPE_GPU:   return "gpu";
        case GGML_BACKEND_DEVICE_TYPE_IGPU:  return "igpu";
        case GGML_BACKEND_DEVICE_TYPE_ACCEL: return "accel";
        case GGML_BACKEND_DEVICE_TYPE_META:  return "meta";
    }
    return "unknown";
}

// The body of upstream's main() for one named device, minus its argv parsing,
// its CPU-skipping default and its stdout. Returns 1 when every case passed.
int run_one_device(int mode_in, const char * backend, const char * op_filter, const char * params_filter,
                   int workers, json_printer & out, std::string & err) {
    test_mode mode;
    switch (mode_in) {
        case JAN_LLAMA_DIAG_MODE_TEST:    mode = MODE_TEST;    break;
        case JAN_LLAMA_DIAG_MODE_SUPPORT: mode = MODE_SUPPORT; break;
        default:
            err = "unknown diagnostic mode " + std::to_string(mode_in);
            return -1;
    }
    if (backend == nullptr || *backend == '\0') {
        err = "a backend name is required";
        return -1;
    }

    const size_t n_dev = ggml_backend_dev_count();
    ggml_backend_dev_t dev = nullptr;
    size_t dev_index = 0;
    for (size_t i = 0; i < n_dev; i++) {
        if (std::strcmp(backend, ggml_backend_dev_name(ggml_backend_dev_get(i))) == 0) {
            dev       = ggml_backend_dev_get(i);
            dev_index = i;
            break;
        }
    }
    if (dev == nullptr) {
        err = std::string("no ggml device named ") + backend;
        return -1;
    }

    ggml_backend_ptr be(ggml_backend_dev_init(dev, nullptr));
    if (be == nullptr) {
        err = std::string("could not initialise the ") + backend + " backend";
        return -1;
    }

    ggml_backend_reg_t reg = ggml_backend_dev_backend_reg(dev);
    auto set_n_threads = (ggml_backend_set_n_threads_t) ggml_backend_reg_get_proc_address(reg, "ggml_backend_set_n_threads");
    if (set_n_threads) {
        set_n_threads(be.get(), std::max<int>(1, N_THREADS / 2));
    }

    size_t free_mem = 0, total_mem = 0;
    ggml_backend_dev_memory(dev, &free_mem, &total_mem);

    out.print_testing_start(testing_start_info(1));
    out.print_backend_init(backend_init_info(dev_index, n_dev, ggml_backend_dev_name(dev), false, "",
                                             ggml_backend_dev_description(dev), total_mem / 1024 / 1024,
                                             free_mem / 1024 / 1024, true));

    const bool ok = test_backend(be.get(), dev, mode, op_filter, params_filter, &out, nullptr, std::max(1, workers));
    out.flush_noise();
    out.print_backend_status(backend_status_info(ggml_backend_name(be.get()), ok ? test_status_t::OK : test_status_t::FAIL));
    // Counted over the devices that ran, not ggml's whole list as upstream's
    // main() does: a leaf runs one, and "3/3 passed" for a skipped two reads
    // as a result it is not.
    out.print_overall_summary(overall_summary_info(ok ? 1 : 0, 1, ok));
    ggml_quantize_free();
    return ok ? 1 : 0;
}

}  // namespace

extern "C" {

int jan_llama_diag_run(int                 mode,
                       const char *        backend,
                       const char *        op_filter,
                       const char *        params_filter,
                       int                 workers,
                       jan_llama_diag_cb   on_event,
                       void *              user_data,
                       char *              err,
                       size_t              err_len) {
    json_printer out(on_event, user_data);
    std::string  msg;
    int          rc = -1;
    try {
        const char * ops    = (op_filter != nullptr && *op_filter != '\0') ? op_filter : nullptr;
        const char * params = (params_filter != nullptr && *params_filter != '\0') ? params_filter : nullptr;
        rc = run_one_device(mode, backend, ops, params, workers, out, msg);
    } catch (const std::exception & e) {
        // Chiefly std::regex_error from a bad -p filter, which upstream's
        // test_backend lets escape.
        msg = std::string("the diagnostic threw: ") + e.what();
        rc = -1;
    } catch (...) {
        msg = "the diagnostic threw a non-standard exception";
        rc = -1;
    }
    out.flush_noise();

    json done = {{"event", "done"}, {"ok", rc == 1}};
    if (rc < 0) {
        done["error"] = msg;
        set_err(err, err_len, msg);
    }
    out.emit(done);
    return rc;
}

// Case counts per op, from the same list `test_backend` runs in test mode.
// Built the way upstream's show_test_coverage does it (graph construction only,
// nothing allocated), so it costs a few seconds of CPU and no device.
char * jan_llama_diag_ops_json(void) {
    std::map<std::string, size_t> counts;
    try {
        // The ops upstream's coverage report considers testable: every op bar
        // the view-like ones, which have no kernel of their own. They start at
        // zero so an untested op is listed rather than absent.
        for (int i = 1; i < GGML_OP_COUNT; i++) {
            auto op = (enum ggml_op) i;
            if (op == GGML_OP_VIEW || op == GGML_OP_RESHAPE || op == GGML_OP_PERMUTE || op == GGML_OP_TRANSPOSE ||
                op == GGML_OP_CONT || op == GGML_OP_GLU || op == GGML_OP_UNARY) {
                continue;
            }
            counts[ggml_op_name(op)];
        }
        for (int i = 0; i < GGML_UNARY_OP_COUNT; i++) {
            counts[ggml_unary_op_name((enum ggml_unary_op) i)];
        }
        for (int i = 0; i < GGML_GLU_OP_COUNT; i++) {
            counts[ggml_glu_op_name((enum ggml_glu_op) i)];
        }

        ggml_init_params params = {
            /* .mem_size = */ ggml_tensor_overhead() * 128 + ggml_graph_overhead(),
            /* .mem_base = */ nullptr,
            /* .no_alloc = */ true,
        };
        // Same size eval() uses, so a case builds the same graph here.
        for (auto & tc : make_test_cases_eval()) {
            ggml_context_ptr ctx(ggml_init(params));
            // Built the way test_case::eval builds it. Upstream's own
            // show_test_coverage calls the one-argument build_graph, which
            // GGML_ASSERTs for a case that keeps its weights in a second
            // context, so a copy of that loop aborts the process.
            ggml_context_ptr ctx_weights(tc->use_weight_context() ? ggml_init(params) : nullptr);
            if (!ctx || (tc->use_weight_context() && !ctx_weights)) {
                continue;
            }
            tc->mode = MODE_TEST;
            // Fusion cases (run_whole_graph) expand into the case's own graph
            // while building, and upstream's coverage report simply drops them
            // for that reason. They are real cases in test mode, so keep them.
            tc->gf = ggml_new_graph(ctx.get());
            ggml_tensor * out = tc->build_graph(ctx.get(), ctx_weights.get());
            if (out && out->op != GGML_OP_NONE) {
                // op_desc is what the -o filter matches against, so a count
                // here is exactly what that filter would select.
                counts[tc->op_desc(out)]++;
            }
        }
    } catch (...) {
        counts.clear();
    }

    json arr = json::array();
    for (const auto & kv : counts) {
        arr.push_back({{"op", kv.first}, {"cases", kv.second}});
    }
    return dup_string(arr.dump(-1, ' ', false, json::error_handler_t::replace));
}

char * jan_llama_diag_backends_json(void) {
    json arr = json::array();
    try {
        for (size_t i = 0; i < ggml_backend_dev_count(); i++) {
            ggml_backend_dev_t dev = ggml_backend_dev_get(i);
            arr.push_back({
                {"name", ggml_backend_dev_name(dev)},
                {"description", ggml_backend_dev_description(dev)},
                {"type", device_type_str(ggml_backend_dev_type(dev))},
                {"reg", ggml_backend_reg_name(ggml_backend_dev_backend_reg(dev))},
            });
        }
    } catch (...) {
        arr = json::array();
    }
    return dup_string(arr.dump(-1, ' ', false, json::error_handler_t::replace));
}

}  // extern "C"
