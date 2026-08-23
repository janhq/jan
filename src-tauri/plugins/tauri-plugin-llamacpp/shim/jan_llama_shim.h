// C ABI over llama.cpp's server-context. Everything OpenAI-shaped -- chat
// templates, tool-call parsing, reasoning, sampling, slots, prompt cache,
// multimodal -- stays inside libserver-context.a; this only moves bytes.
#ifndef JAN_LLAMA_SHIM_H
#define JAN_LLAMA_SHIM_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct jan_llama_engine   jan_llama_engine;
typedef struct jan_llama_response jan_llama_response;

// argv is llama-server's own flag set (common_params_parse), so callers reuse
// the upstream arg table instead of mirroring common_params across the FFI.
// Returns NULL on failure and writes a message into err.
jan_llama_engine * jan_llama_engine_start(const char * const * argv,
                                          int                  argc,
                                          char *               err,
                                          size_t               err_len);

// Starts from a router.preset.ini section, exactly as Jan already generates it:
// the [*] section is applied first, then the named one overrides it.
jan_llama_engine * jan_llama_engine_start_from_preset(const char * ini_path,
                                                     const char * preset_name,
                                                     char *       err,
                                                     size_t       err_len);

void jan_llama_engine_stop(jan_llama_engine * engine);

// route names match server_routes members, e.g. "post_chat_completions".
// Never returns NULL: transport failures come back as a 5xx response.
//
// `query` is a url query string ("id_slot=0&action=save"), parsed into the
// request's param map. llama.cpp reads slot actions and a few flags from there
// rather than from the body, so a route like post_slots is unreachable without
// it. NULL or "" means no params.
jan_llama_response * jan_llama_engine_request(jan_llama_engine * engine,
                                              const char *       route,
                                              const char *       query,
                                              const char *       body,
                                              size_t             body_len);

int          jan_llama_response_status(const jan_llama_response * res);
const char * jan_llama_response_content_type(const jan_llama_response * res);
const char * jan_llama_response_body(const jan_llama_response * res, size_t * len);
int          jan_llama_response_is_stream(const jan_llama_response * res);

// 1 = chunk written (valid until the next call on this response), 0 = finished,
// -1 = the generator threw. Empty chunks are legal and mean "nothing yet".
int jan_llama_response_next(jan_llama_response * res, const char ** chunk, size_t * len);

void jan_llama_response_free(jan_llama_response * res);

// Asks the in-flight generator to stop; safe to call from another thread.
void jan_llama_response_cancel(jan_llama_response * res);

// Registers the ggml compute backends. `dir` names a directory of backend
// modules; NULL uses ggml's own search (the executable's directory, then the
// cwd), which is what a packaged install wants.
//
// Only call this with a non-NULL `dir` when the executable has no backend
// modules beside it: ggml's loader has no already-loaded guard, so a directory
// pre-load followed by its internal search would register a backend twice.
void jan_llama_load_backends(const char * dir);

// The devices this build can offload to, as a JSON array of
// {id, name, mem, free} with memory in MiB -- the same fields the old
// `llama-server --list-devices` stdout was parsed into, so the Rust and TS
// sides are unchanged. Needs no engine: ggml devices are process-global.
// Never NULL; free the result with jan_llama_string_free.
char * jan_llama_devices_json(void);

void jan_llama_string_free(char * s);

// The llama.cpp the shim was compiled against, for the pin assertion in
// build.rs / engine::assert_pinned_version.
const char * jan_llama_version(void);       // e.g. "0.2.0"
int          jan_llama_build_number(void);  // e.g. 10582
const char * jan_llama_commit(void);

#ifdef __cplusplus
}
#endif
#endif
