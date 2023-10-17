import { Bot } from "@/_models/Bot";
import { atom } from "jotai";

export const activeBotAtom = atom<Bot | undefined>(undefined);
