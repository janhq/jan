/**
 * The worker runtime for Jan extensions: the wire protocol, the endpoint both
 * sides run, the handle tables that carry callbacks and disposables across
 * the boundary, and the composition of a worker script. The prelude itself
 * is `./prelude-source`; the node:vm sandbox for tests is `./testing`.
 */
export {
  DEFAULT_TIMEOUT_MS,
  Endpoint,
  MAX_IN_FLIGHT,
  MAX_MESSAGE_BYTES,
  portTransport,
  type EndpointOptions,
  type PortLike,
  type RequestHandler,
  type RequestOptions,
  type Transport,
} from './endpoint.js'
export {
  fromRpcError,
  isErrorCode,
  toRpcError,
  type RpcError,
} from './errors.js'
export {
  CancellationTokenSource,
  DisposableTable,
  HandleTable,
  NONE_TOKEN,
} from './handles.js'
export {
  DEACTIVATE_METHOD,
  DISPOSE_METHOD,
  HOST_METHODS,
  INVOKE_METHOD,
  PROTOCOL_VERSION,
  callbackRef,
  eventRef,
  isCallbackRef,
  isEventRef,
  isHostMethod,
  parseWire,
  type CallbackRef,
  type ControlMessage,
  type EventRef,
  type EventSubscription,
  type HostArgs,
  type HostEventName,
  type HostEvents,
  type HostMethod,
  type HostMethodSignatures,
  type HostResult,
  type LogLevel,
  type RegistrationReply,
  type Wire,
  type WireResult,
} from './protocol.js'
export { composeWorkerSource } from './compose.js'
export { workerTransport, type WorkerLike } from './worker-like.js'
export { ACTIVATE_TIMEOUT_MS, BOOT_FUNCTION } from './worker/runtime.js'
export { STRIPPED_GLOBALS, STRIPPED_NAVIGATOR } from './worker/strip.js'
