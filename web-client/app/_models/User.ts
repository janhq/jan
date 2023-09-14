export interface User {
  id: string;
  displayName: string;
  avatarUrl: string;
  email?: string;
}

export const DefaultUser = {
  id: "0",
  displayName: "Anonymous",
  avatarUrl: "/icons/app_icon.svg",
  email: "",
};

export enum Role {
  User = "user",
  Assistant = "assistant",
}