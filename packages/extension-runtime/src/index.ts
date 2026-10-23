/**
 * The worker runtime for Jan extensions: the wire protocol, the endpoint both
 * sides run, and the handle tables that carry callbacks and disposables
 * across the boundary.
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
  INVOKE_METHOD,
  PROTOCOL_VERSION,
  callbackRef,
  eventRef,
  isCallbackRef,
  isEventRef,
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
} from './protocol.js'
