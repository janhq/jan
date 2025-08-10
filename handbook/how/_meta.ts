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
  github: "Github",
  discord: "Discord",
  sprints: "Sprints",
  okrs: "OKRs",
  infra: "Infra",
  analytics: "Analytics",
};

export default meta;
