import type { MetaRecord } from "nextra";

/**
 * type MetaRecordValue =
 *  | TitleSchema
 *  | PageItemSchema
 *  | SeparatorSchema
 *  | MenuSchema
 *
 * type MetaRecord = Record<string, MetaRecordValue>
 **/
const meta: MetaRecord = {
  problem: "What problem are we solving?",
  timeline: {
    title: "How we got here",
    display: "hidden",
  },
  icp: "Who we are building for",
  happy: {
    title: "How we make users happy",
    display: "hidden",
  },
  ownership: "Who owns Menlo?",
};

export default meta;
