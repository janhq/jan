#include "jan_llama_shim.h"

#include "server-context.h"
#include "server-http.h"

#include "arg.h"
#include "preset.h"
#include "common.h"
#include "log.h"
#include "build-info.h"
#include "llama.h"
#include "ggml-backend.h"

#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <vector>
#include <chrono>
#include <thread>
#include <unordered_map>

struct jan_llama_engine;

namespace {

void set_err(char * err, size_t err_len, const std::string & msg) {
    if (err == nullptr || err_len == 0) {
        return;
    }
    const size_t n = std::min(msg.size(), err_len - 1);
    std::memcpy(err, msg.data(), n);
    err[n] = '\0';
}

jan_llama_engine * finish_start(std::unique_ptr<jan_llama_engine> engine,
                                char * err, size_t err_len);

// `server_context::load_model` returns a bool and puts the reason -- a CUDA
// OOM, an unsupported arch, a missing backend -- only in the log, so a caller
// that reports the bool alone cannot tell those apart. These collect
// ERROR-level lines while a load runs so `set_err` can carry the cause.
//
// The first lines are kept rather than the last: the cause comes first
// (`cudaMalloc failed: out of memory`) and everything after it is fallout, and
// keeping the head also stops an unrelated error from a model already serving
// in this process from evicting it.
constexpr size_t LOG_CAPTURE_MAX_LINES = 8;

std::mutex               g_capture_mu;
std::vector<std::string> g_captured;
bool                     g_capturing = false;

void capture_log_callback(ggml_log_level level, const char * text, void * user_data) {
    if (level == GGML_LOG_LEVEL_ERROR && text != nullptr) {
        std::lock_guard<std::mutex> lock(g_capture_mu);
        if (g_capturing && g_captured.size() < LOG_CAPTURE_MAX_LINES) {
            std::string line(text);
            while (!line.empty() && (line.back() == '\n' || line.back() == '\r')) {
                line.pop_back();
            }
            if (!line.empty()) {
                g_captured.push_back(std::move(line));
            }
        }
    }
    common_log_default_callback(level, text, user_data);
}

// Scoped so every exit from the load -- including a throw -- stops capturing.
struct log_capture {
    log_capture() {
        std::lock_guard<std::mutex> lock(g_capture_mu);
        g_captured.clear();
        g_capturing = true;
    }

    ~log_capture() { finish(""); }

    std::string message(const std::string & summary) { return finish(summary); }

private:
    std::string finish(const std::string & summary) {
        std::lock_guard<std::mutex> lock(g_capture_mu);
        g_capturing = false;
        std::string out = summary;
        for (const auto & line : g_captured) {
            out += "; ";
            out += line;
        }
        g_captured.clear();
        return out;
    }
};

// Device descriptions are vendor strings and have carried backslashes and
// quotes; emitting them raw would produce JSON the Rust side cannot parse.
std::string json_quote(const char * raw) {
    std::string out = "\"";
    for (const char * p = raw == nullptr ? "" : raw; *p != '\0'; ++p) {
        const unsigned char c = static_cast<unsigned char>(*p);
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n";  break;
            case '\r': out += "\\r";  break;
            case '\t': out += "\\t";  break;
            default:
                if (c < 0x20) {
                    char esc[7];
                    std::snprintf(esc, sizeof(esc), "\\u%04x", c);
                    out += esc;
                } else {
                    out += static_cast<char>(c);
                }
        }
    }
    out += '"';
    return out;
}

// llama.cpp reads slot actions from the query string, so the shim has to hand
// it a param map. Percent-decoding is included because a value is not
// guaranteed to be url-safe -- ours are ints and fixed keywords, but a caller
// with a filename would silently get the escaped form otherwise.
int hex_value(unsigned char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

std::string url_decode(const std::string & in) {
    std::string out;
    out.reserve(in.size());
    for (size_t i = 0; i < in.size(); ++i) {
        if (in[i] == '+') {
            out += ' ';
            continue;
        }
        if (in[i] == '%' && i + 2 < in.size()) {
            const int hi = hex_value(static_cast<unsigned char>(in[i + 1]));
            const int lo = hex_value(static_cast<unsigned char>(in[i + 2]));
            if (hi >= 0 && lo >= 0) {
                out += static_cast<char>(hi * 16 + lo);
                i += 2;
                continue;
            }
        }
        out += in[i];
    }
    return out;
}

std::map<std::string, std::string> parse_query(const char * query) {
    std::map<std::string, std::string> out;
    if (query == nullptr) {
        return out;
    }
    std::string q(query);
    size_t pos = 0;
    while (pos < q.size()) {
        const size_t amp = q.find('&', pos);
        const std::string pair = q.substr(pos, amp == std::string::npos ? std::string::npos : amp - pos);
        pos = amp == std::string::npos ? q.size() : amp + 1;
        if (pair.empty()) {
            continue;
        }
        const size_t eq = pair.find('=');
        if (eq == std::string::npos) {
            out[url_decode(pair)] = "";
        } else {
            out[url_decode(pair.substr(0, eq))] = url_decode(pair.substr(eq + 1));
        }
    }
    return out;
}

} // namespace

struct jan_llama_engine {
    common_params params;
    server_context ctx;
    std::unique_ptr<server_routes> routes;
    std::thread loop;
    std::atomic<bool> running{false};
    // Set once start_loop() has returned, i.e. the loop is provably finished.
    // stop() polls this because server_queue::start_loop sets `running = true`
    // at its top (server-queue.cpp:279): a terminate() that lands before the
    // loop thread reaches that line is erased, and the loop then blocks
    // forever. Re-issuing terminate() until the thread exits is the only
    // ordering-independent fix.
    std::atomic<bool> loop_done{false};

    std::unordered_map<std::string, server_http_context::handler_t *> table;

    void build_table() {
        auto & r = *routes;
        table = {
            {"get_health",                 &r.get_health},
            {"get_metrics",                &r.get_metrics},
            {"get_slots",                  &r.get_slots},
            {"post_slots",                 &r.post_slots},
            {"get_props",                  &r.get_props},
            {"post_props",                 &r.post_props},
            {"post_infill",                &r.post_infill},
            {"post_completions",           &r.post_completions},
            {"post_completions_oai",       &r.post_completions_oai},
            {"post_chat_completions",      &r.post_chat_completions},
            {"post_chat_completions_tok",  &r.post_chat_completions_tok},
            {"post_control",               &r.post_control},
            {"post_responses_oai",         &r.post_responses_oai},
            {"post_apply_template",        &r.post_apply_template},
            {"get_models",                 &r.get_models},
            {"post_tokenize",              &r.post_tokenize},
            {"post_detokenize",            &r.post_detokenize},
            {"post_embeddings",            &r.post_embeddings},
            {"post_embeddings_oai",        &r.post_embeddings_oai},
            {"post_rerank",                &r.post_rerank},
            {"get_lora_adapters",          &r.get_lora_adapters},
            {"post_lora_adapters",         &r.post_lora_adapters},
        };
    }
};

// server-context.cpp:4188 does `res->set_req(&req)`, and server_res_spipe keeps
// that pointer for the life of the stream -- so the request, and the
// std::function its `should_stop` member references, must outlive the response.
// Declaration order here is the destruction order that guarantees it.
struct jan_llama_response {
    std::atomic<bool> cancel{false};
    std::function<bool()> should_stop;
    std::unique_ptr<server_http_req> req;
    server_http_res_ptr res;

    std::string chunk;         // owns the buffer handed back across the ABI
    bool drained = false;      // next() reported the last chunk
    bool completed = false;    // on_complete() has run

    void finish() {
        if (res && !completed) {
            res->on_complete();
            completed = true;
        }
    }

    ~jan_llama_response() {
        finish();
    }
};

jan_llama_engine * jan_llama_engine_start(const char * const * argv,
                                          int                  argc,
                                          char *               err,
                                          size_t               err_len) {
    try {
        auto engine = std::make_unique<jan_llama_engine>();

        // common_params_parse wants char**; it does not retain the pointers.
        std::vector<std::string> owned;
        owned.reserve(argc);
        for (int i = 0; i < argc; i++) {
            owned.emplace_back(argv[i] ? argv[i] : "");
        }
        std::vector<char *> raw;
        raw.reserve(argc);
        for (auto & s : owned) {
            raw.push_back(const_cast<char *>(s.c_str()));
        }

        if (!common_params_parse(argc, raw.data(), engine->params, LLAMA_EXAMPLE_SERVER)) {
            set_err(err, err_len, "failed to parse server arguments");
            return nullptr;
        }

        return finish_start(std::move(engine), err, err_len);
    } catch (const std::exception & e) {
        set_err(err, err_len, e.what());
        return nullptr;
    } catch (...) {
        set_err(err, err_len, "unknown exception while starting the engine");
        return nullptr;
    }
}

jan_llama_engine * jan_llama_engine_start_from_preset(const char * ini_path,
                                                     const char * preset_name,
                                                     char *       err,
                                                     size_t       err_len) {
    try {
        if (ini_path == nullptr || preset_name == nullptr) {
            set_err(err, err_len, "ini_path and preset_name are required");
            return nullptr;
        }
        auto engine = std::make_unique<jan_llama_engine>();

        common_preset_context pctx(LLAMA_EXAMPLE_SERVER);
        // The ini is shared with the router, which owns keys like
        // load-on-startup that are not common_params options.
        pctx.ignore_unknown_keys = true;

        common_preset global;
        common_presets presets = pctx.load_from_ini(ini_path, global);

        auto it = presets.find(preset_name);
        if (it == presets.end()) {
            set_err(err, err_len, std::string("no such preset: ") + preset_name);
            return nullptr;
        }

        // [*] first, then the named section overrides it.
        global.apply_to_params(engine->params);
        it->second.apply_to_params(engine->params);

        // common_params_parse does this at arg.cpp:892-896; apply_to_params does
        // not. Without it n_threads stays 0 and ggml_threadpool_new_impl
        // memsets a zero-length array -> SIGSEGV. The router never hits this
        // because it forwards keys to a child that re-parses them.
        postprocess_cpu_params(engine->params.cpuparams, nullptr);
        postprocess_cpu_params(engine->params.cpuparams_batch, &engine->params.cpuparams);
        postprocess_cpu_params(engine->params.speculative.draft.cpuparams,
                               &engine->params.cpuparams);
        postprocess_cpu_params(engine->params.speculative.draft.cpuparams_batch,
                               &engine->params.cpuparams_batch);

        // Same omission, arg.cpp:946-954: common_params_fit needs spare slots
        // to write its overrides into and throws "did not provide buffer to
        // set tensor_buft_overrides" without them, so auto-fit silently gave
        // up and the load then asked for more VRAM than the device had.
        const size_t ntbo = llama_max_tensor_buft_overrides();
        while (engine->params.tensor_buft_overrides.size() < ntbo) {
            engine->params.tensor_buft_overrides.push_back({nullptr, nullptr});
        }
        if (!engine->params.speculative.draft.tensor_buft_overrides.empty()) {
            engine->params.speculative.draft.tensor_buft_overrides.push_back({nullptr, nullptr});
        }

        return finish_start(std::move(engine), err, err_len);
    } catch (const std::exception & e) {
        set_err(err, err_len, e.what());
        return nullptr;
    } catch (...) {
        set_err(err, err_len, "unknown exception while starting from preset");
        return nullptr;
    }
}

namespace {

jan_llama_engine * finish_start(std::unique_ptr<jan_llama_engine> engine,
                                char * err, size_t err_len) {
    try {
        common_init();
        // After common_init, which installs its own callback.
        llama_log_set(capture_log_callback, nullptr);
        llama_backend_init();
        llama_numa_init(engine->params.numa);

        // Must be constructed before load_model: its ctor registers the
        // on_sleeping_state callback the sleep path depends on.
        engine->routes = std::make_unique<server_routes>(engine->params, engine->ctx);

        log_capture capture;
        if (!engine->ctx.load_model(engine->params)) {
            set_err(err, err_len, capture.message("failed to load model"));
            return nullptr;
        }

        engine->routes->update_meta(engine->ctx);
        engine->build_table();

        // start_loop blocks, so it gets its own thread and requests arrive from
        // the caller's threads via server_queue.
        engine->running.store(true);
        auto * raw_engine = engine.get();
        engine->loop = std::thread([raw_engine]() {
            try {
                raw_engine->ctx.start_loop();
            } catch (const std::exception & e) {
                LOG_ERR("server loop threw: %s\n", e.what());
            } catch (...) {
                LOG_ERR("%s", "server loop threw an unknown exception\n");
            }
            raw_engine->running.store(false);
            raw_engine->loop_done.store(true);
        });

        return engine.release();
    } catch (const std::exception & e) {
        set_err(err, err_len, e.what());
        return nullptr;
    } catch (...) {
        set_err(err, err_len, "unknown exception while finishing startup");
        return nullptr;
    }
}

} // namespace

void jan_llama_engine_stop(jan_llama_engine * engine) {
    if (engine == nullptr) {
        return;
    }
    // Re-issue terminate until the loop actually exits: a single call can be
    // lost to the `running = true` at the top of server_queue::start_loop.
    constexpr int  STOP_POLLS    = 200;         // ~10s ceiling
    constexpr auto STOP_INTERVAL = std::chrono::milliseconds(50);
    for (int i = 0; i < STOP_POLLS && !engine->loop_done.load(); ++i) {
        try {
            engine->ctx.terminate();
        } catch (...) {
            // best-effort; the join below is what actually decides
        }
        if (engine->loop_done.load()) {
            break;
        }
        std::this_thread::sleep_for(STOP_INTERVAL);
    }
    if (!engine->loop_done.load()) {
        LOG_ERR("%s", "server loop did not stop; leaking it rather than "
                      "blocking teardown forever\n");
        engine->loop.detach();
        // The engine is deliberately not deleted: the detached loop still
        // references it. Leaking one object on a shutdown path we already
        // failed is better than a use-after-free.
        return;
    }
    if (engine->loop.joinable()) {
        engine->loop.join();
    }
    delete engine;
    llama_backend_free();
}

jan_llama_response * jan_llama_engine_request(jan_llama_engine * engine,
                                              const char *       route,
                                              const char *       query,
                                              const char *       body,
                                              size_t             body_len) {
    auto out = new jan_llama_response();
    try {
        if (engine == nullptr || route == nullptr) {
            out->res = std::make_unique<server_http_res>();
            out->res->status = 500;
            out->res->data = R"({"error":{"message":"engine or route is null"}})";
            return out;
        }

        auto it = engine->table.find(route);
        if (it == engine->table.end()) {
            out->res = std::make_unique<server_http_res>();
            out->res->status = 404;
            out->res->data = std::string(R"({"error":{"message":"unknown route: )") + route + "\"}}";
            return out;
        }

        out->should_stop = [cancel = &out->cancel]() { return cancel->load(); };
        out->req.reset(new server_http_req{
            /* params       */ parse_query(query),
            /* headers      */ {},
            /* path         */ route,
            /* query_string */ query ? query : "",
            /* body         */ std::string(body ? body : "", body_len),
            /* files        */ {},
            /* should_stop  */ out->should_stop,
        });

        out->res = (*it->second)(*out->req);
        if (!out->res) {
            out->res = std::make_unique<server_http_res>();
            out->res->status = 500;
            out->res->data = R"({"error":{"message":"handler returned no response"}})";
        }
        return out;
    } catch (const std::exception & e) {
        out->res = std::make_unique<server_http_res>();
        out->res->status = 500;
        out->res->data = std::string(R"({"error":{"message":")") + e.what() + "\"}}";
        return out;
    } catch (...) {
        out->res = std::make_unique<server_http_res>();
        out->res->status = 500;
        out->res->data = R"({"error":{"message":"unknown exception in handler"}})";
        return out;
    }
}

int jan_llama_response_status(const jan_llama_response * res) {
    return (res && res->res) ? res->res->status : 500;
}

const char * jan_llama_response_content_type(const jan_llama_response * res) {
    return (res && res->res) ? res->res->content_type.c_str() : "";
}

const char * jan_llama_response_body(const jan_llama_response * res, size_t * len) {
    if (!res || !res->res) {
        if (len) *len = 0;
        return "";
    }
    if (len) *len = res->res->data.size();
    return res->res->data.c_str();
}

int jan_llama_response_is_stream(const jan_llama_response * res) {
    return (res && res->res && res->res->is_stream()) ? 1 : 0;
}

int jan_llama_response_next(jan_llama_response * res, const char ** chunk, size_t * len) {
    if (!res || !res->res || !res->res->next) {
        return 0;
    }
    if (res->drained) {
        return 0;
    }
    try {
        res->chunk.clear();
        const bool more = res->res->next(res->chunk);
        if (chunk) *chunk = res->chunk.c_str();
        if (len)   *len   = res->chunk.size();
        if (!more) {
            // Last call: hand back any trailing bytes now and report completion
            // on the next call, so a final chunk is never dropped.
            res->drained = true;
            res->finish();
            return res->chunk.empty() ? 0 : 1;
        }
        return 1;
    } catch (...) {
        res->drained = true;
        return -1;
    }
}

void jan_llama_response_cancel(jan_llama_response * res) {
    if (res) {
        res->cancel.store(true);
    }
}

void jan_llama_response_free(jan_llama_response * res) {
    delete res;
}

void jan_llama_load_backends(const char * dir) {
    try {
        if (dir == nullptr || *dir == '\0') {
            ggml_backend_load_all();
        } else {
            ggml_backend_load_all_from_path(dir);
        }
    } catch (...) {
        // A backend module that throws while loading must not abort startup;
        // the engine degrades to whatever did register.
    }
}

// Mirrors common_print_available_devices (common/arg.cpp:1139-1161): load every
// backend, then report the non-CPU devices with memory in MiB. The CPU device
// is excluded there too -- "offload to CPU" is not a choice the setting offers.
char * jan_llama_devices_json(void) {
    constexpr size_t MiB = 1024 * 1024;
    std::string out = "[";
    try {
        bool first = true;
        for (size_t i = 0; i < ggml_backend_dev_count(); ++i) {
            ggml_backend_dev_t dev = ggml_backend_dev_get(i);
            if (ggml_backend_dev_type(dev) == GGML_BACKEND_DEVICE_TYPE_CPU) {
                continue;
            }
            size_t free_mem = 0;
            size_t total    = 0;
            ggml_backend_dev_memory(dev, &free_mem, &total);
            if (!first) {
                out += ',';
            }
            first = false;
            out += "{\"id\":";
            out += json_quote(ggml_backend_dev_name(dev));
            out += ",\"name\":";
            out += json_quote(ggml_backend_dev_description(dev));
            out += ",\"mem\":" + std::to_string(total / MiB);
            out += ",\"free\":" + std::to_string(free_mem / MiB) + "}";
        }
    } catch (...) {
        // A backend module that throws while probing must not abort the
        // process: an empty list reads as "no GPU", which is recoverable.
        out = "[";
    }
    out += ']';

    char * buf = static_cast<char *>(std::malloc(out.size() + 1));
    if (buf == nullptr) {
        return nullptr;
    }
    std::memcpy(buf, out.c_str(), out.size() + 1);
    return buf;
}

void jan_llama_string_free(char * s) {
    std::free(s);
}

// llama_version() is libllama's (include/llama.h); llama_build_number() and
// llama_commit() come from build-info.cpp in llama-common-base.
const char * jan_llama_version(void) {
    return llama_version();
}

int jan_llama_build_number(void) {
    return llama_build_number();
}

const char * jan_llama_commit(void) {
    return llama_commit();
}
