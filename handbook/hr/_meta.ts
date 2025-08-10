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
  leave: "Time off",
  "side-gigs": "Side gigs",
  spending: "Spending",
  retreats: "Team retreats",
  travel: "Travel",
  progression: "Progression",
  "1-on-1s": "1-on-1s",
};

export default meta;
