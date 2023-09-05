import { Instance, castToSnapshot, flow, types } from "mobx-state-tree";
import { Conversation } from "./Conversation";
import { Product, AiModelType } from "./Product";
import { User } from "../_models/User";
import {
  ChatMessage,
  MessageSenderType,
  MessageStatus,
  MessageType,
} from "./ChatMessage";
import { MESSAGE_PER_PAGE } from "../_utils/const";
import { controlNetRequest } from "@/_services/controlnet";

import {
  ApolloCache,
  DefaultContext,
  FetchResult,
  LazyQueryExecFunction,
  MutationFunctionOptions,
  OperationVariables,
  QueryResult,
} from "@apollo/client";
import {
  ConversationDetailFragment,
  CreateMessageMutation,
  CreateMessageMutationVariables,
  GenerateImageMutation,
  GenerateImageMutationVariables,
  GetConversationMessagesQuery,
  GetConversationMessagesQueryVariables,
  MessageDetailFragment,
  ProductDetailFragment,
} from "@/graphql";

export enum Role {
  User = "user",
  Assistant = "assistant",
}

type CreateMessageMutationFunc = (
  options?:
    | MutationFunctionOptions<
        CreateMessageMutation,
        OperationVariables,
        DefaultContext,
        ApolloCache<any>
      >
    | undefined
) => Promise<FetchResult<CreateMessageMutation>>;

type ImageGenerationMutationFunc = (
  options?:
    | MutationFunctionOptions<
        GenerateImageMutation,
        OperationVariables,
        DefaultContext,
        ApolloCache<any>
      >
    | undefined
) => Promise<FetchResult<GenerateImageMutation>>;

export const History = types
  .model("History", {
    conversations: types.optional(types.array(Conversation), []),
    activeConversationId: types.maybe(types.string),
  })
  .volatile(() => ({
    showModelDetail: false,
    showAdvancedPrompt: false,
  }))
  .views((self) => ({
    getActiveConversation() {
      if (self.activeConversationId) {
        return self.conversations.find(
          (c) => c.id === self.activeConversationId
        );
      }
    },

    getActiveMessages() {
      if (self.activeConversationId) {
        const conversation = self.conversations.find(
          (c) => c.id === self.activeConversationId
        );

        if (conversation) {
          return conversation.chatMessages;
        }
      }
      return [];
    },

    getConversationById(conversationId: string) {
      return self.conversations.find((c) => c.id === conversationId);
    },
  }))
  .actions((self) => ({
    // Model detail
    toggleModelDetail() {
      self.showModelDetail = !self.showModelDetail;
    },

    toggleAdvancedPrompt() {
      self.showAdvancedPrompt = !self.showAdvancedPrompt;
    },

    closeModelDetail() {
      if (self.showModelDetail) {
        self.showModelDetail = false;
      }
    },

    finishActiveConversationWaiting() {
      self.getActiveConversation()?.setWaitingForModelResponse(false);
    },
  }))
  .actions((self) => {
    const fetchMoreMessages = flow(function* (
      func: LazyQueryExecFunction<
        GetConversationMessagesQuery,
        OperationVariables
      >
    ) {
      const convoId = self.activeConversationId;
      if (!convoId) {
        console.error("No active conversation found");
        return;
      }

      const convo = self.getConversationById(convoId);
      if (!convo) {
        console.error("Could not get convo", convoId);
        return;
      }
      if (convo?.isFetching) {
        return;
      }

      if (!convo.hasMore) {
        console.info("Already load all messages of convo", convoId);
        return;
      }
      convo.isFetching = true;
      const variables: GetConversationMessagesQueryVariables = {
        conversation_id: convoId,
        limit: MESSAGE_PER_PAGE,
        offset: convo.offset,
      };
      const result: QueryResult<
        GetConversationMessagesQuery,
        OperationVariables
      > = yield func({ variables });

      if (!result.data?.messages) {
        return;
      }

      if (result.data?.messages.length < MESSAGE_PER_PAGE) {
        convo.setHasMore(false);
      }

      convo.offset += result.data.messages.length;

      const messages: Instance<typeof ChatMessage>[] = [];
      result.data.messages.forEach((m: MessageDetailFragment) => {
        const createdAt = new Date(m.created_at).getTime();
        const imageUrls: string[] = [];
        const imageUrl =
          m.message_medias.length > 0 ? m.message_medias[0].media_url : null;
        if (imageUrl) {
          imageUrls.push(imageUrl);
        }

        const messageType = m.message_type
          ? MessageType[m.message_type as keyof typeof MessageType]
          : MessageType.Text;
        const messageSenderType = m.message_sender_type
          ? MessageSenderType[
              m.message_sender_type as keyof typeof MessageSenderType
            ]
          : MessageSenderType.Ai;
        messages.push(
          ChatMessage.create({
            id: m.id,
            conversationId: m.conversation_id,
            messageType: messageType,
            messageSenderType: messageSenderType,
            senderUid: m.sender,
            senderName: m.sender_name ?? "",
            senderAvatarUrl: m.sender_avatar_url,
            text: m.content ?? "",
            status: m.status as MessageStatus,
            imageUrls: imageUrls,
            createdAt: createdAt,
          })
        );
      });
      convo.setProp(
        "chatMessages",
        messages.reverse().concat(convo.chatMessages)
      );
      convo.isFetching = false;
    });

    const deleteConversationById = flow(function* (convoId: string) {
      const updateConversations = self.conversations.filter(
        (c) => c.id !== convoId
      );
      self.conversations = castToSnapshot([...updateConversations]);
      self.activeConversationId = undefined;
    });

    return {
      fetchMoreMessages,
      deleteConversationById,
    };
  })
  .actions((self) => {
    const setActiveConversationId = flow(function* (
      convoId: string | undefined
    ) {
      self.activeConversationId = convoId;
    });

    return { setActiveConversationId };
  })
  .actions((self) => ({
    clearActiveConversationId() {
      self.activeConversationId = undefined;
      self.showModelDetail = false;
      self.showAdvancedPrompt = false;
    },

    setConversations(conversations: Instance<typeof Conversation>[]) {
      self.conversations = castToSnapshot(conversations);
    },

    clearAllConversations() {
      self.conversations = castToSnapshot([]);
    },
  }))
  .actions((self) => {
    const sendTextToTextMessage = flow(function* (
      create: CreateMessageMutationFunc,
      conversation: Instance<typeof Conversation>
    ) {
      // TODO: handle case timeout using higher order function
      const latestMessages = conversation.chatMessages.slice(-5).map((e) => ({
        role:
          e.messageSenderType === MessageSenderType.User
            ? Role.User
            : Role.Assistant,
        content: e.text,
      }));

      const variables: CreateMessageMutationVariables = {
        data: {
          conversation_id: conversation.id,
          content: "",
          sender: MessageSenderType.Ai,
          message_sender_type: MessageSenderType.Ai,
          message_type: MessageType.Text,
          sender_avatar_url: conversation.product.avatarUrl,
          sender_name: conversation.product.name,
          prompt_cache: latestMessages,
          status: MessageStatus.Pending,
        },
      };
      const result: FetchResult<CreateMessageMutation> = yield create({
        variables,
      });

      if (!result.data?.insert_messages_one?.id) {
        console.error(
          "Error creating user message",
          JSON.stringify(result.errors)
        );
        conversation.setWaitingForModelResponse(false);
        return;
      }

      const aiResponseMessage = ChatMessage.create({
        id: result.data.insert_messages_one.id,
        conversationId: conversation.id,
        messageType: MessageType.Text,
        messageSenderType: MessageSenderType.Ai,
        senderUid: conversation.product.id,
        senderName: conversation.product.name,
        senderAvatarUrl: conversation.product.avatarUrl ?? "",
        text: "",
        status: MessageStatus.Pending,
        createdAt: Date.now(),
      });
      conversation.addMessage(aiResponseMessage);
    });

    const sendTextToImageMessage = flow(function* (
      create: CreateMessageMutationFunc,
      generateImage: ImageGenerationMutationFunc,
      message: string,
      conversation: Instance<typeof Conversation>
    ) {
      // TODO: handle case timeout using higher order function
      // const data = yield api.textToImage(conversation.product.id, message);
      const variables: GenerateImageMutationVariables = {
        model: conversation.product.id,
        prompt: message,
        neg_prompt: "",
        seed: Math.floor(Math.random() * 429496729),
        steps: 30,
        width: 512,
        height: 512,
      };
      const data: FetchResult<GenerateImageMutation> = yield generateImage({
        variables,
      });

      if (!data.data?.imageGeneration?.url) {
        // TODO: display error
        console.error(
          "Error creating user message",
          JSON.stringify(data.errors)
        );
        conversation.setWaitingForModelResponse(false);
        return;
      }

      const imageUrl: string = data.data.imageGeneration.url;

      const createMessageVariables: CreateMessageMutationVariables = {
        data: {
          conversation_id: conversation.id,
          content: message,
          sender: MessageSenderType.Ai,
          message_sender_type: MessageSenderType.Ai,
          message_type: MessageType.Image,
          sender_avatar_url: conversation.product.avatarUrl,
          sender_name: conversation.product.name,
          status: MessageStatus.Ready,
          message_medias: {
            data: [
              {
                media_url: imageUrl,
                mime_type: "image/jpeg",
              },
            ],
          },
        },
      };
      const result: FetchResult<CreateMessageMutation> = yield create({
        variables: createMessageVariables,
      });

      if (!result.data?.insert_messages_one?.id) {
        // TODO: display error
        console.error(
          "Error creating user message",
          JSON.stringify(result.errors)
        );
        conversation.setWaitingForModelResponse(false);
        return;
      }

      const imageResponseMessage = ChatMessage.create({
        id: result.data.insert_messages_one.id,
        conversationId: conversation.id,
        messageType: MessageType.Image,
        messageSenderType: MessageSenderType.Ai,
        senderUid: conversation.product.id,
        senderName: conversation.product.name,
        senderAvatarUrl: conversation.product.avatarUrl,
        text: message,
        imageUrls: [imageUrl],
        createdAt: Date.now(),
        status: MessageStatus.Ready,
      });

      conversation.addMessage(imageResponseMessage);
      conversation.setProp("updatedAt", Date.now());
      conversation.setProp("lastImageUrl", imageUrl);

      conversation.setWaitingForModelResponse(false);
    });

    return {
      sendTextToTextMessage,
      sendTextToImageMessage,
    };
  })
  .actions((self) => {
    const sendControlNetPrompt = flow(function* (
      create: CreateMessageMutationFunc,
      prompt: string,
      negPrompt: string,
      file: any // TODO: file type, for now I don't know what is that
    ) {
      if (!self.activeConversationId) {
        console.error("No active conversation found");
        return;
      }

      const conversation = self.getActiveConversation();
      if (!conversation) {
        console.error(
          "No active conversation found with id",
          self.activeConversationId
        );
        return;
      }

      conversation.setWaitingForModelResponse(true);

      const imageUrl = yield controlNetRequest("", prompt, negPrompt, file);
      if (!imageUrl || !imageUrl.startsWith("https://")) {
        console.error(
          "Failed to invoking control net",
          self.activeConversationId
        );
        return;
      }
      const message = `${prompt}. Negative: ${negPrompt}`;

      const variables: CreateMessageMutationVariables = {
        data: {
          conversation_id: conversation.id,
          content: message,
          sender: MessageSenderType.Ai,
          message_sender_type: MessageSenderType.Ai,
          message_type: MessageType.ImageWithText,
          sender_avatar_url: conversation.product.avatarUrl,
          sender_name: conversation.product.name,
          message_medias: {
            data: [
              {
                media_url: imageUrl,
              },
            ],
          },
        },
      };
      const result: FetchResult<CreateMessageMutation> = yield create({
        variables,
      });

      if (!result.data?.insert_messages_one?.id) {
        // TODO: display error
        console.error(
          "Error creating user message",
          JSON.stringify(result.errors)
        );
        conversation.setWaitingForModelResponse(false);
        return;
      }

      const chatMessage = ChatMessage.create({
        id: result.data.insert_messages_one.id,
        conversationId: self.activeConversationId,
        messageType: MessageType.ImageWithText,
        messageSenderType: MessageSenderType.Ai,
        senderUid: conversation.product.id,
        senderName: conversation.product.name,
        senderAvatarUrl: conversation.product.avatarUrl,
        text: message,
        imageUrls: [imageUrl],
        createdAt: Date.now(),
        status: MessageStatus.Ready,
      });
      conversation.addMessage(chatMessage);
      conversation.setProp("lastTextMessage", message);
      conversation.setProp("lastImageUrl", imageUrl);
      conversation.setWaitingForModelResponse(false);
    });

    const createConversation = flow(function* (
      conversation: ConversationDetailFragment,
      product: ProductDetailFragment,
      userId: string,
      displayName: string,
      avatarUrl?: string
    ) {
      let modelType: AiModelType | undefined = undefined;
      if (product.inputs.slug === "llm") {
        modelType = AiModelType.LLM;
      } else if (product.inputs.slug === "sd") {
        modelType = AiModelType.GenerativeArt;
      } else if (product.inputs.slug === "controlnet") {
        modelType = AiModelType.ControlNet;
      } else {
        console.error("Model type not supported");
        return;
      }

      const productModel = Product.create({
        name: product.name,
        id: product.slug,
        type: modelType,
        description: product.description,
        modelUrl: product.source_url,
        modelVersion: product.version,
        avatarUrl: product.image_url,
      });

      const newConvo = Conversation.create({
        id: conversation.id,
        product: productModel,
        lastTextMessage: conversation.last_text_message ?? "",
        user: User.create({
          id: userId,
          displayName,
          avatarUrl,
        }),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      self.conversations.push(newConvo);
      self.activeConversationId = newConvo.id;
    });

    const sendMessage = flow(function* (
      create: CreateMessageMutationFunc,
      generateImage: ImageGenerationMutationFunc,
      message: string,
      userId: string,
      displayName: string,
      avatarUrl?: string
    ) {
      if (!self.activeConversationId) {
        console.error("No active conversation found");
        return;
      }

      const conversation = self.getActiveConversation();
      if (!conversation) {
        console.error(
          "No active conversation found with id",
          self.activeConversationId
        );
        return;
      }
      conversation.setWaitingForModelResponse(true);
      const variables: CreateMessageMutationVariables = {
        data: {
          conversation_id: conversation.id,
          content: message,
          sender: userId,
          message_sender_type: MessageSenderType.User,
          message_type: MessageType.Text,
          sender_avatar_url: avatarUrl,
          sender_name: displayName,
        },
      };
      const result: FetchResult<CreateMessageMutation> = yield create({
        variables,
      });

      if (!result.data?.insert_messages_one?.id) {
        // TODO: display error
        console.error(
          "Error creating user message",
          JSON.stringify(result.errors)
        );
        conversation.setWaitingForModelResponse(false);
        return;
      }

      const userMesssage = ChatMessage.create({
        id: result.data.insert_messages_one.id,
        conversationId: self.activeConversationId,
        messageType: MessageType.Text,
        messageSenderType: MessageSenderType.User,
        senderUid: userId,
        senderName: displayName,
        senderAvatarUrl: avatarUrl,
        text: message,
        createdAt: Date.now(),
        status: MessageStatus.Ready,
      });
      conversation.addMessage(userMesssage);
      conversation.setProp("lastTextMessage", message);

      if (conversation.product.type === AiModelType.LLM) {
        yield self.sendTextToTextMessage(create, conversation);
      } else if (conversation.product.type === AiModelType.GenerativeArt) {
        yield self.sendTextToImageMessage(
          create,
          generateImage,
          message,
          conversation
        );
      } else {
        console.error(
          "We do not support this model type yet:",
          conversation.product.type
        );
      }
    });

    return {
      sendMessage,
      sendControlNetPrompt,
      createConversation,
    };
  });
