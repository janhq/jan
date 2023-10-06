import { Product } from "@/_models/Product";
import { atom } from "jotai";

export const downloadedModelAtom = atom<Product[]>([]);
