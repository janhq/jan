import { CustomChatTransport } from "@/lib/custom-chat-transport";
// import { useCapabilities } from "@/stores/capabilities-store";
import {
  Chat,
  type UIMessage,
  type UseChatOptions,
  useChat as useChatSDK,
} from "@ai-sdk/react";
import {
  type ChatInit,
  type LanguageModel,
  type LanguageModelUsage,
  type UIDataTypes,
  type UITools,
} from "ai";
import { useEffect, useMemo, useRef, useCallback } from "react";
import { useChatSessions } from "@/stores/chat-session-store";
import { useAppState } from "@/hooks/useAppState";

// Tool call type from AI SDK
type ToolCall = {
  toolCallId: string;
  toolName: string;
  input: unknown;
};

type CustomChatOptions = Omit<ChatInit<UIMessage>, "transport"> &
  Pick<UseChatOptions<UIMessage>, "experimental_throttle" | "resume"> & {
    sessionId?: string;
    sessionTitle?: string;
    onTokenUsage?: (usage: LanguageModelUsage, messageId: string) => void;
    onFinish?: (params: { message: UIMessage; isAbort?: boolean }) => void;
    onToolCall?: (params: { toolCall: ToolCall }) => void;
    sendAutomaticallyWhen?: (params: {
      messages: UIMessage<unknown, UIDataTypes, UITools>[];
    }) => boolean;
  };

// This is a wrapper around the AI SDK's useChat hook
// It implements model switching and uses the custom chat transport,
// making a nice reusable hook for chat functionality.
export function useChat(model: LanguageModel | null, options?: CustomChatOptions) {
  const transportRef = useRef<CustomChatTransport | undefined>(undefined); // Using a ref here so we can update the model used in the transport without having to reload the page or recreate the transport
  const {
    sessionId,
    sessionTitle,
    experimental_throttle,
    onTokenUsage,
    onFinish,
    onToolCall,
    sendAutomaticallyWhen,
    ...chatInitOptions
  } = options ?? {};
  const ensureSession = useChatSessions((state) => state.ensureSession);
  const setSessionTitle = useChatSessions((state) => state.setSessionTitle);
  const updateStatus = useChatSessions((state) => state.updateStatus);

  const existingSessionTransport = sessionId
    ? useChatSessions.getState().sessions[sessionId]?.transport
    : undefined;

  // Only create transport when model is available
  if (model && transportRef.current?.model !== model) {
    transportRef.current =
      existingSessionTransport ??
      new CustomChatTransport(
        model,
      );
  } else if (
    existingSessionTransport &&
    transportRef.current !== existingSessionTransport
  ) {
    transportRef.current = existingSessionTransport;
  }

  useEffect(() => {
    if (model && transportRef.current?.model !== model) {
      transportRef.current!.updateModel(model);
    }
  }, [model]);

  // Update the token usage callback when it changes
  useEffect(() => {
    if (transportRef.current) {
      transportRef.current.setOnTokenUsage(onTokenUsage);
    }
  }, [onTokenUsage]);

  // Update the onFinish callback when it changes
  useEffect(() => {
    if (transportRef.current) {
      transportRef.current.setOnFinish(onFinish);
    }
  }, [onFinish]);

  // Set up streaming token speed callback to update global state
  const setTokenSpeed = useAppState((state) => state.setTokenSpeed);
  const resetTokenSpeed = useAppState((state) => state.resetTokenSpeed);

  const handleStreamingTokenSpeed = useCallback(
    (tokenCount: number, elapsedMs: number) => {
      const elapsedSec = elapsedMs / 1000;
      const speed = elapsedSec > 0 ? tokenCount / elapsedSec : 0;
      // Use a minimal ThreadMessage-like object for the state update
      setTokenSpeed({ id: sessionId || "" } as Parameters<typeof setTokenSpeed>[0], speed, tokenCount);
    },
    [sessionId, setTokenSpeed]
  );

  useEffect(() => {
    if (transportRef.current) {
      transportRef.current.setOnStreamingTokenSpeed(handleStreamingTokenSpeed);
    }
  }, [handleStreamingTokenSpeed]);

  // Memoize to prevent calling ensureSession (which has side effects) on every render
  const chat = useMemo(() => {
    if (!sessionId || !transportRef.current) return undefined;
    return ensureSession(
      sessionId,
      transportRef.current,
      () => new Chat({ ...chatInitOptions, transport: transportRef.current }),
      sessionTitle,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, ensureSession, model]);

  useEffect(() => {
    if (sessionId && sessionTitle) {
      setSessionTitle(sessionId, sessionTitle);
    }
  }, [sessionId, sessionTitle, setSessionTitle]);

  const chatResult = useChatSDK({
    ...(chat
      ? { chat }
      : { transport: transportRef.current, ...chatInitOptions }),
    experimental_throttle,
    resume: false,
    onFinish,
    onToolCall,
    sendAutomaticallyWhen,
  });

  useEffect(() => {
    if (sessionId) {
      updateStatus(sessionId, chatResult.status);
    }
  }, [sessionId, chatResult.status, updateStatus]);

  // Reset token speed when streaming stops
  useEffect(() => {
    if (chatResult.status !== "streaming") {
      resetTokenSpeed();
    }
  }, [chatResult.status, resetTokenSpeed]);

  return chatResult;
}
