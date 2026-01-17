import { CustomChatTransport } from "@/lib/custom-chat-transport";
// import { useCapabilities } from "@/stores/capabilities-store";
import {
  Chat,
  type UIMessage,
  type UseChatOptions,
  useChat as useChatSDK,
} from "@ai-sdk/react";
import { type ChatInit, type LanguageModel } from "ai";
import { useEffect, useMemo, useRef } from "react";
import { useChatSessions } from "@/stores/chat-session-store";

type CustomChatOptions = Omit<ChatInit<UIMessage>, "transport"> &
  Pick<UseChatOptions<UIMessage>, "experimental_throttle" | "resume"> & {
    sessionId?: string;
    sessionTitle?: string;
  };

// This is a wrapper around the AI SDK's useChat hook
// It implements model switching and uses the custom chat transport,
// making a nice reusable hook for chat functionality.
export function useChat(model: LanguageModel, options?: CustomChatOptions) {
  const transportRef = useRef<CustomChatTransport | undefined>(undefined); // Using a ref here so we can update the model used in the transport without having to reload the page or recreate the transport
  const { sessionId, sessionTitle, experimental_throttle, ...chatInitOptions } =
    options ?? {};
  const ensureSession = useChatSessions((state) => state.ensureSession);
  const setSessionTitle = useChatSessions((state) => state.setSessionTitle);
  const updateStatus = useChatSessions((state) => state.updateStatus);

  const existingSessionTransport = sessionId
    ? useChatSessions.getState().sessions[sessionId]?.transport
    : undefined;

  if (!transportRef.current) {
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
    if (transportRef.current) {
      transportRef.current.updateModel(model);
    }
  }, [model]);

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
  }, [sessionId, ensureSession]);

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
  });

  useEffect(() => {
    if (sessionId) {
      updateStatus(sessionId, chatResult.status);
    }
  }, [sessionId, chatResult.status, updateStatus]);

  return chatResult;
}
