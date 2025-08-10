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
  index: {
    title: "Welcome",
  },
  "about-seperator": {
    title: "About Menlo",
    type: "separator",
  },
  why: "1. Why does Menlo Exist?",
  money: "2. How we make Money",
  who: "3. Who We Hire",
  philosophy: "5. Menlo's Philosophies",
  brand: "6. Brand & Identity",
  "how-we-work-separator": {
    title: "How We Work",
    type: "separator",
  },
  team: "Team Roster",
  culture: "Menlo's Culture",
  how: "How We Build",
  sell: "How We Sell",
  "hr-separator": {
    title: "HR",
    type: "separator",
  },
  lifecycle: "HR Lifecycle",
  hr: "HR Policies",
  comp: "Compensation",
};

export default meta;
