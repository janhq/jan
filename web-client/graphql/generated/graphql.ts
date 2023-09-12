/* eslint-disable */
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  jsonb: { input: any; output: any; }
  timestamptz: { input: any; output: any; }
  uuid: { input: any; output: any; }
};

/** Boolean expression to compare columns of type "Boolean". All fields are combined with logical 'AND'. */
export type Boolean_Comparison_Exp = {
  _eq?: InputMaybe<Scalars['Boolean']['input']>;
  _gt?: InputMaybe<Scalars['Boolean']['input']>;
  _gte?: InputMaybe<Scalars['Boolean']['input']>;
  _in?: InputMaybe<Array<Scalars['Boolean']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['Boolean']['input']>;
  _lte?: InputMaybe<Scalars['Boolean']['input']>;
  _neq?: InputMaybe<Scalars['Boolean']['input']>;
  _nin?: InputMaybe<Array<Scalars['Boolean']['input']>>;
};

export type ImageGenerationInput = {
  height: Scalars['Int']['input'];
  model: Scalars['String']['input'];
  neg_prompt: Scalars['String']['input'];
  prompt: Scalars['String']['input'];
  seed: Scalars['Int']['input'];
  steps: Scalars['Int']['input'];
  width: Scalars['Int']['input'];
};

export type ImageGenerationOutput = {
  __typename?: 'ImageGenerationOutput';
  url: Scalars['String']['output'];
};

/** Boolean expression to compare columns of type "Int". All fields are combined with logical 'AND'. */
export type Int_Comparison_Exp = {
  _eq?: InputMaybe<Scalars['Int']['input']>;
  _gt?: InputMaybe<Scalars['Int']['input']>;
  _gte?: InputMaybe<Scalars['Int']['input']>;
  _in?: InputMaybe<Array<Scalars['Int']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['Int']['input']>;
  _lte?: InputMaybe<Scalars['Int']['input']>;
  _neq?: InputMaybe<Scalars['Int']['input']>;
  _nin?: InputMaybe<Array<Scalars['Int']['input']>>;
};

/** Boolean expression to compare columns of type "String". All fields are combined with logical 'AND'. */
export type String_Comparison_Exp = {
  _eq?: InputMaybe<Scalars['String']['input']>;
  _gt?: InputMaybe<Scalars['String']['input']>;
  _gte?: InputMaybe<Scalars['String']['input']>;
  /** does the column match the given case-insensitive pattern */
  _ilike?: InputMaybe<Scalars['String']['input']>;
  _in?: InputMaybe<Array<Scalars['String']['input']>>;
  /** does the column match the given POSIX regular expression, case insensitive */
  _iregex?: InputMaybe<Scalars['String']['input']>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  /** does the column match the given pattern */
  _like?: InputMaybe<Scalars['String']['input']>;
  _lt?: InputMaybe<Scalars['String']['input']>;
  _lte?: InputMaybe<Scalars['String']['input']>;
  _neq?: InputMaybe<Scalars['String']['input']>;
  /** does the column NOT match the given case-insensitive pattern */
  _nilike?: InputMaybe<Scalars['String']['input']>;
  _nin?: InputMaybe<Array<Scalars['String']['input']>>;
  /** does the column NOT match the given POSIX regular expression, case insensitive */
  _niregex?: InputMaybe<Scalars['String']['input']>;
  /** does the column NOT match the given pattern */
  _nlike?: InputMaybe<Scalars['String']['input']>;
  /** does the column NOT match the given POSIX regular expression, case sensitive */
  _nregex?: InputMaybe<Scalars['String']['input']>;
  /** does the column NOT match the given SQL regular expression */
  _nsimilar?: InputMaybe<Scalars['String']['input']>;
  /** does the column match the given POSIX regular expression, case sensitive */
  _regex?: InputMaybe<Scalars['String']['input']>;
  /** does the column match the given SQL regular expression */
  _similar?: InputMaybe<Scalars['String']['input']>;
};

/** columns and relationships of "collection_products" */
export type Collection_Products = {
  __typename?: 'collection_products';
  collection_id: Scalars['uuid']['output'];
  /** An array relationship */
  collections: Array<Collections>;
  /** An aggregate relationship */
  collections_aggregate: Collections_Aggregate;
  created_at: Scalars['timestamptz']['output'];
  id: Scalars['uuid']['output'];
  product_id: Scalars['uuid']['output'];
  /** An array relationship */
  products: Array<Products>;
  /** An aggregate relationship */
  products_aggregate: Products_Aggregate;
  updated_at: Scalars['timestamptz']['output'];
};


/** columns and relationships of "collection_products" */
export type Collection_ProductsCollectionsArgs = {
  distinct_on?: InputMaybe<Array<Collections_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Collections_Order_By>>;
  where?: InputMaybe<Collections_Bool_Exp>;
};


/** columns and relationships of "collection_products" */
export type Collection_ProductsCollections_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Collections_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Collections_Order_By>>;
  where?: InputMaybe<Collections_Bool_Exp>;
};


/** columns and relationships of "collection_products" */
export type Collection_ProductsProductsArgs = {
  distinct_on?: InputMaybe<Array<Products_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Products_Order_By>>;
  where?: InputMaybe<Products_Bool_Exp>;
};


/** columns and relationships of "collection_products" */
export type Collection_ProductsProducts_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Products_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Products_Order_By>>;
  where?: InputMaybe<Products_Bool_Exp>;
};

/** aggregated selection of "collection_products" */
export type Collection_Products_Aggregate = {
  __typename?: 'collection_products_aggregate';
  aggregate?: Maybe<Collection_Products_Aggregate_Fields>;
  nodes: Array<Collection_Products>;
};

export type Collection_Products_Aggregate_Bool_Exp = {
  count?: InputMaybe<Collection_Products_Aggregate_Bool_Exp_Count>;
};

export type Collection_Products_Aggregate_Bool_Exp_Count = {
  arguments?: InputMaybe<Array<Collection_Products_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
  filter?: InputMaybe<Collection_Products_Bool_Exp>;
  predicate: Int_Comparison_Exp;
};

/** aggregate fields of "collection_products" */
export type Collection_Products_Aggregate_Fields = {
  __typename?: 'collection_products_aggregate_fields';
  count: Scalars['Int']['output'];
  max?: Maybe<Collection_Products_Max_Fields>;
  min?: Maybe<Collection_Products_Min_Fields>;
};


/** aggregate fields of "collection_products" */
export type Collection_Products_Aggregate_FieldsCountArgs = {
  columns?: InputMaybe<Array<Collection_Products_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
};

/** order by aggregate values of table "collection_products" */
export type Collection_Products_Aggregate_Order_By = {
  count?: InputMaybe<Order_By>;
  max?: InputMaybe<Collection_Products_Max_Order_By>;
  min?: InputMaybe<Collection_Products_Min_Order_By>;
};

/** input type for inserting array relation for remote table "collection_products" */
export type Collection_Products_Arr_Rel_Insert_Input = {
  data: Array<Collection_Products_Insert_Input>;
  /** upsert condition */
  on_conflict?: InputMaybe<Collection_Products_On_Conflict>;
};

/** Boolean expression to filter rows from the table "collection_products". All fields are combined with a logical 'AND'. */
export type Collection_Products_Bool_Exp = {
  _and?: InputMaybe<Array<Collection_Products_Bool_Exp>>;
  _not?: InputMaybe<Collection_Products_Bool_Exp>;
  _or?: InputMaybe<Array<Collection_Products_Bool_Exp>>;
  collection_id?: InputMaybe<Uuid_Comparison_Exp>;
  collections?: InputMaybe<Collections_Bool_Exp>;
  collections_aggregate?: InputMaybe<Collections_Aggregate_Bool_Exp>;
  created_at?: InputMaybe<Timestamptz_Comparison_Exp>;
  id?: InputMaybe<Uuid_Comparison_Exp>;
  product_id?: InputMaybe<Uuid_Comparison_Exp>;
  products?: InputMaybe<Products_Bool_Exp>;
  products_aggregate?: InputMaybe<Products_Aggregate_Bool_Exp>;
  updated_at?: InputMaybe<Timestamptz_Comparison_Exp>;
};

/** unique or primary key constraints on table "collection_products" */
export enum Collection_Products_Constraint {
  /** unique or primary key constraint on columns "product_id", "collection_id" */
  CollectionProductsCollectionIdProductIdKey = 'collection_products_collection_id_product_id_key',
  /** unique or primary key constraint on columns "id" */
  CollectionProductsPkey = 'collection_products_pkey'
}

/** input type for inserting data into table "collection_products" */
export type Collection_Products_Insert_Input = {
  collection_id?: InputMaybe<Scalars['uuid']['input']>;
  collections?: InputMaybe<Collections_Arr_Rel_Insert_Input>;
  created_at?: InputMaybe<Scalars['timestamptz']['input']>;
  id?: InputMaybe<Scalars['uuid']['input']>;
  product_id?: InputMaybe<Scalars['uuid']['input']>;
  products?: InputMaybe<Products_Arr_Rel_Insert_Input>;
  updated_at?: InputMaybe<Scalars['timestamptz']['input']>;
};

/** aggregate max on columns */
export type Collection_Products_Max_Fields = {
  __typename?: 'collection_products_max_fields';
  collection_id?: Maybe<Scalars['uuid']['output']>;
  created_at?: Maybe<Scalars['timestamptz']['output']>;
  id?: Maybe<Scalars['uuid']['output']>;
  product_id?: Maybe<Scalars['uuid']['output']>;
  updated_at?: Maybe<Scalars['timestamptz']['output']>;
};

/** order by max() on columns of table "collection_products" */
export type Collection_Products_Max_Order_By = {
  collection_id?: InputMaybe<Order_By>;
  created_at?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  product_id?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** aggregate min on columns */
export type Collection_Products_Min_Fields = {
  __typename?: 'collection_products_min_fields';
  collection_id?: Maybe<Scalars['uuid']['output']>;
  created_at?: Maybe<Scalars['timestamptz']['output']>;
  id?: Maybe<Scalars['uuid']['output']>;
  product_id?: Maybe<Scalars['uuid']['output']>;
  updated_at?: Maybe<Scalars['timestamptz']['output']>;
};

/** order by min() on columns of table "collection_products" */
export type Collection_Products_Min_Order_By = {
  collection_id?: InputMaybe<Order_By>;
  created_at?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  product_id?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** response of any mutation on the table "collection_products" */
export type Collection_Products_Mutation_Response = {
  __typename?: 'collection_products_mutation_response';
  /** number of rows affected by the mutation */
  affected_rows: Scalars['Int']['output'];
  /** data from the rows affected by the mutation */
  returning: Array<Collection_Products>;
};

/** on_conflict condition type for table "collection_products" */
export type Collection_Products_On_Conflict = {
  constraint: Collection_Products_Constraint;
  update_columns?: Array<Collection_Products_Update_Column>;
  where?: InputMaybe<Collection_Products_Bool_Exp>;
};

/** Ordering options when selecting data from "collection_products". */
export type Collection_Products_Order_By = {
  collection_id?: InputMaybe<Order_By>;
  collections_aggregate?: InputMaybe<Collections_Aggregate_Order_By>;
  created_at?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  product_id?: InputMaybe<Order_By>;
  products_aggregate?: InputMaybe<Products_Aggregate_Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** primary key columns input for table: collection_products */
export type Collection_Products_Pk_Columns_Input = {
  id: Scalars['uuid']['input'];
};

/** select columns of table "collection_products" */
export enum Collection_Products_Select_Column {
  /** column name */
  CollectionId = 'collection_id',
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  Id = 'id',
  /** column name */
  ProductId = 'product_id',
  /** column name */
  UpdatedAt = 'updated_at'
}

/** input type for updating data in table "collection_products" */
export type Collection_Products_Set_Input = {
  collection_id?: InputMaybe<Scalars['uuid']['input']>;
  created_at?: InputMaybe<Scalars['timestamptz']['input']>;
  id?: InputMaybe<Scalars['uuid']['input']>;
  product_id?: InputMaybe<Scalars['uuid']['input']>;
  updated_at?: InputMaybe<Scalars['timestamptz']['input']>;
};

/** Streaming cursor of the table "collection_products" */
export type Collection_Products_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Collection_Products_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Collection_Products_Stream_Cursor_Value_Input = {
  collection_id?: InputMaybe<Scalars['uuid']['input']>;
  created_at?: InputMaybe<Scalars['timestamptz']['input']>;
  id?: InputMaybe<Scalars['uuid']['input']>;
  product_id?: InputMaybe<Scalars['uuid']['input']>;
  updated_at?: InputMaybe<Scalars['timestamptz']['input']>;
};

/** update columns of table "collection_products" */
export enum Collection_Products_Update_Column {
  /** column name */
  CollectionId = 'collection_id',
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  Id = 'id',
  /** column name */
  ProductId = 'product_id',
  /** column name */
  UpdatedAt = 'updated_at'
}

export type Collection_Products_Updates = {
  /** sets the columns of the filtered rows to the given values */
  _set?: InputMaybe<Collection_Products_Set_Input>;
  /** filter the rows which have to be updated */
  where: Collection_Products_Bool_Exp;
};

/** columns and relationships of "collections" */
export type Collections = {
  __typename?: 'collections';
  /** An array relationship */
  collection_products: Array<Collection_Products>;
  /** An aggregate relationship */
  collection_products_aggregate: Collection_Products_Aggregate;
  created_at: Scalars['timestamptz']['output'];
  description: Scalars['String']['output'];
  id: Scalars['uuid']['output'];
  name: Scalars['String']['output'];
  slug: Scalars['String']['output'];
  updated_at: Scalars['timestamptz']['output'];
};


/** columns and relationships of "collections" */
export type CollectionsCollection_ProductsArgs = {
  distinct_on?: InputMaybe<Array<Collection_Products_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Collection_Products_Order_By>>;
  where?: InputMaybe<Collection_Products_Bool_Exp>;
};


/** columns and relationships of "collections" */
export type CollectionsCollection_Products_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Collection_Products_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Collection_Products_Order_By>>;
  where?: InputMaybe<Collection_Products_Bool_Exp>;
};

/** aggregated selection of "collections" */
export type Collections_Aggregate = {
  __typename?: 'collections_aggregate';
  aggregate?: Maybe<Collections_Aggregate_Fields>;
  nodes: Array<Collections>;
};

export type Collections_Aggregate_Bool_Exp = {
  count?: InputMaybe<Collections_Aggregate_Bool_Exp_Count>;
};

export type Collections_Aggregate_Bool_Exp_Count = {
  arguments?: InputMaybe<Array<Collections_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
  filter?: InputMaybe<Collections_Bool_Exp>;
  predicate: Int_Comparison_Exp;
};

/** aggregate fields of "collections" */
export type Collections_Aggregate_Fields = {
  __typename?: 'collections_aggregate_fields';
  count: Scalars['Int']['output'];
  max?: Maybe<Collections_Max_Fields>;
  min?: Maybe<Collections_Min_Fields>;
};


/** aggregate fields of "collections" */
export type Collections_Aggregate_FieldsCountArgs = {
  columns?: InputMaybe<Array<Collections_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
};

/** order by aggregate values of table "collections" */
export type Collections_Aggregate_Order_By = {
  count?: InputMaybe<Order_By>;
  max?: InputMaybe<Collections_Max_Order_By>;
  min?: InputMaybe<Collections_Min_Order_By>;
};

/** input type for inserting array relation for remote table "collections" */
export type Collections_Arr_Rel_Insert_Input = {
  data: Array<Collections_Insert_Input>;
  /** upsert condition */
  on_conflict?: InputMaybe<Collections_On_Conflict>;
};

/** Boolean expression to filter rows from the table "collections". All fields are combined with a logical 'AND'. */
export type Collections_Bool_Exp = {
  _and?: InputMaybe<Array<Collections_Bool_Exp>>;
  _not?: InputMaybe<Collections_Bool_Exp>;
  _or?: InputMaybe<Array<Collections_Bool_Exp>>;
  collection_products?: InputMaybe<Collection_Products_Bool_Exp>;
  collection_products_aggregate?: InputMaybe<Collection_Products_Aggregate_Bool_Exp>;
  created_at?: InputMaybe<Timestamptz_Comparison_Exp>;
  description?: InputMaybe<String_Comparison_Exp>;
  id?: InputMaybe<Uuid_Comparison_Exp>;
  name?: InputMaybe<String_Comparison_Exp>;
  slug?: InputMaybe<String_Comparison_Exp>;
  updated_at?: InputMaybe<Timestamptz_Comparison_Exp>;
};

/** unique or primary key constraints on table "collections" */
export enum Collections_Constraint {
  /** unique or primary key constraint on columns "id" */
  CollectionsPkey = 'collections_pkey',
  /** unique or primary key constraint on columns "slug" */
  CollectionsSlugKey = 'collections_slug_key'
}

/** input type for inserting data into table "collections" */
export type Collections_Insert_Input = {
  collection_products?: InputMaybe<Collection_Products_Arr_Rel_Insert_Input>;
  created_at?: InputMaybe<Scalars['timestamptz']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['uuid']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamptz']['input']>;
};

/** aggregate max on columns */
export type Collections_Max_Fields = {
  __typename?: 'collections_max_fields';
  created_at?: Maybe<Scalars['timestamptz']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['uuid']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  slug?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamptz']['output']>;
};

/** order by max() on columns of table "collections" */
export type Collections_Max_Order_By = {
  created_at?: InputMaybe<Order_By>;
  description?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  name?: InputMaybe<Order_By>;
  slug?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** aggregate min on columns */
export type Collections_Min_Fields = {
  __typename?: 'collections_min_fields';
  created_at?: Maybe<Scalars['timestamptz']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['uuid']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  slug?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamptz']['output']>;
};

/** order by min() on columns of table "collections" */
export type Collections_Min_Order_By = {
  created_at?: InputMaybe<Order_By>;
  description?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  name?: InputMaybe<Order_By>;
  slug?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** response of any mutation on the table "collections" */
export type Collections_Mutation_Response = {
  __typename?: 'collections_mutation_response';
  /** number of rows affected by the mutation */
  affected_rows: Scalars['Int']['output'];
  /** data from the rows affected by the mutation */
  returning: Array<Collections>;
};

/** on_conflict condition type for table "collections" */
export type Collections_On_Conflict = {
  constraint: Collections_Constraint;
  update_columns?: Array<Collections_Update_Column>;
  where?: InputMaybe<Collections_Bool_Exp>;
};

/** Ordering options when selecting data from "collections". */
export type Collections_Order_By = {
  collection_products_aggregate?: InputMaybe<Collection_Products_Aggregate_Order_By>;
  created_at?: InputMaybe<Order_By>;
  description?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  name?: InputMaybe<Order_By>;
  slug?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** primary key columns input for table: collections */
export type Collections_Pk_Columns_Input = {
  id: Scalars['uuid']['input'];
};

/** select columns of table "collections" */
export enum Collections_Select_Column {
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  Description = 'description',
  /** column name */
  Id = 'id',
  /** column name */
  Name = 'name',
  /** column name */
  Slug = 'slug',
  /** column name */
  UpdatedAt = 'updated_at'
}

/** input type for updating data in table "collections" */
export type Collections_Set_Input = {
  created_at?: InputMaybe<Scalars['timestamptz']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['uuid']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamptz']['input']>;
};

/** Streaming cursor of the table "collections" */
export type Collections_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Collections_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Collections_Stream_Cursor_Value_Input = {
  created_at?: InputMaybe<Scalars['timestamptz']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['uuid']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamptz']['input']>;
};

/** update columns of table "collections" */
export enum Collections_Update_Column {
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  Description = 'description',
  /** column name */
  Id = 'id',
  /** column name */
  Name = 'name',
  /** column name */
  Slug = 'slug',
  /** column name */
  UpdatedAt = 'updated_at'
}

export type Collections_Updates = {
  /** sets the columns of the filtered rows to the given values */
  _set?: InputMaybe<Collections_Set_Input>;
  /** filter the rows which have to be updated */
  where: Collections_Bool_Exp;
};

/** columns and relationships of "conversations" */
export type Conversations = {
  __typename?: 'conversations';
  /** An array relationship */
  conversation_messages: Array<Messages>;
  /** An aggregate relationship */
  conversation_messages_aggregate: Messages_Aggregate;
  /** An object relationship */
  conversation_product?: Maybe<Products>;
  created_at: Scalars['timestamptz']['output'];
  id: Scalars['uuid']['output'];
  last_image_url?: Maybe<Scalars['String']['output']>;
  last_text_message?: Maybe<Scalars['String']['output']>;
  product_id: Scalars['uuid']['output'];
  updated_at: Scalars['timestamptz']['output'];
  user_id: Scalars['String']['output'];
};


/** columns and relationships of "conversations" */
export type ConversationsConversation_MessagesArgs = {
  distinct_on?: InputMaybe<Array<Messages_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Messages_Order_By>>;
  where?: InputMaybe<Messages_Bool_Exp>;
};


/** columns and relationships of "conversations" */
export type ConversationsConversation_Messages_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Messages_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Messages_Order_By>>;
  where?: InputMaybe<Messages_Bool_Exp>;
};

/** aggregated selection of "conversations" */
export type Conversations_Aggregate = {
  __typename?: 'conversations_aggregate';
  aggregate?: Maybe<Conversations_Aggregate_Fields>;
  nodes: Array<Conversations>;
};

/** aggregate fields of "conversations" */
export type Conversations_Aggregate_Fields = {
  __typename?: 'conversations_aggregate_fields';
  count: Scalars['Int']['output'];
  max?: Maybe<Conversations_Max_Fields>;
  min?: Maybe<Conversations_Min_Fields>;
};


/** aggregate fields of "conversations" */
export type Conversations_Aggregate_FieldsCountArgs = {
  columns?: InputMaybe<Array<Conversations_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
};

/** Boolean expression to filter rows from the table "conversations". All fields are combined with a logical 'AND'. */
export type Conversations_Bool_Exp = {
  _and?: InputMaybe<Array<Conversations_Bool_Exp>>;
  _not?: InputMaybe<Conversations_Bool_Exp>;
  _or?: InputMaybe<Array<Conversations_Bool_Exp>>;
  conversation_messages?: InputMaybe<Messages_Bool_Exp>;
  conversation_messages_aggregate?: InputMaybe<Messages_Aggregate_Bool_Exp>;
  conversation_product?: InputMaybe<Products_Bool_Exp>;
  created_at?: InputMaybe<Timestamptz_Comparison_Exp>;
  id?: InputMaybe<Uuid_Comparison_Exp>;
  last_image_url?: InputMaybe<String_Comparison_Exp>;
  last_text_message?: InputMaybe<String_Comparison_Exp>;
  product_id?: InputMaybe<Uuid_Comparison_Exp>;
  updated_at?: InputMaybe<Timestamptz_Comparison_Exp>;
  user_id?: InputMaybe<String_Comparison_Exp>;
};

/** unique or primary key constraints on table "conversations" */
export enum Conversations_Constraint {
  /** unique or primary key constraint on columns "id" */
  ConversationsPkey = 'conversations_pkey'
}

/** input type for inserting data into table "conversations" */
export type Conversations_Insert_Input = {
  conversation_messages?: InputMaybe<Messages_Arr_Rel_Insert_Input>;
  conversation_product?: InputMaybe<Products_Obj_Rel_Insert_Input>;
  created_at?: InputMaybe<Scalars['timestamptz']['input']>;
  id?: InputMaybe<Scalars['uuid']['input']>;
  last_image_url?: InputMaybe<Scalars['String']['input']>;
  last_text_message?: InputMaybe<Scalars['String']['input']>;
  product_id?: InputMaybe<Scalars['uuid']['input']>;
  updated_at?: InputMaybe<Scalars['timestamptz']['input']>;
  user_id?: InputMaybe<Scalars['String']['input']>;
};

/** aggregate max on columns */
export type Conversations_Max_Fields = {
  __typename?: 'conversations_max_fields';
  created_at?: Maybe<Scalars['timestamptz']['output']>;
  id?: Maybe<Scalars['uuid']['output']>;
  last_image_url?: Maybe<Scalars['String']['output']>;
  last_text_message?: Maybe<Scalars['String']['output']>;
  product_id?: Maybe<Scalars['uuid']['output']>;
  updated_at?: Maybe<Scalars['timestamptz']['output']>;
  user_id?: Maybe<Scalars['String']['output']>;
};

/** aggregate min on columns */
export type Conversations_Min_Fields = {
  __typename?: 'conversations_min_fields';
  created_at?: Maybe<Scalars['timestamptz']['output']>;
  id?: Maybe<Scalars['uuid']['output']>;
  last_image_url?: Maybe<Scalars['String']['output']>;
  last_text_message?: Maybe<Scalars['String']['output']>;
  product_id?: Maybe<Scalars['uuid']['output']>;
  updated_at?: Maybe<Scalars['timestamptz']['output']>;
  user_id?: Maybe<Scalars['String']['output']>;
};

/** response of any mutation on the table "conversations" */
export type Conversations_Mutation_Response = {
  __typename?: 'conversations_mutation_response';
  /** number of rows affected by the mutation */
  affected_rows: Scalars['Int']['output'];
  /** data from the rows affected by the mutation */
  returning: Array<Conversations>;
};

/** input type for inserting object relation for remote table "conversations" */
export type Conversations_Obj_Rel_Insert_Input = {
  data: Conversations_Insert_Input;
  /** upsert condition */
  on_conflict?: InputMaybe<Conversations_On_Conflict>;
};

/** on_conflict condition type for table "conversations" */
export type Conversations_On_Conflict = {
  constraint: Conversations_Constraint;
  update_columns?: Array<Conversations_Update_Column>;
  where?: InputMaybe<Conversations_Bool_Exp>;
};

/** Ordering options when selecting data from "conversations". */
export type Conversations_Order_By = {
  conversation_messages_aggregate?: InputMaybe<Messages_Aggregate_Order_By>;
  conversation_product?: InputMaybe<Products_Order_By>;
  created_at?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  last_image_url?: InputMaybe<Order_By>;
  last_text_message?: InputMaybe<Order_By>;
  product_id?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
  user_id?: InputMaybe<Order_By>;
};

/** primary key columns input for table: conversations */
export type Conversations_Pk_Columns_Input = {
  id: Scalars['uuid']['input'];
};

/** select columns of table "conversations" */
export enum Conversations_Select_Column {
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  Id = 'id',
  /** column name */
  LastImageUrl = 'last_image_url',
  /** column name */
  LastTextMessage = 'last_text_message',
  /** column name */
  ProductId = 'product_id',
  /** column name */
  UpdatedAt = 'updated_at',
  /** column name */
  UserId = 'user_id'
}

/** input type for updating data in table "conversations" */
export type Conversations_Set_Input = {
  created_at?: InputMaybe<Scalars['timestamptz']['input']>;
  id?: InputMaybe<Scalars['uuid']['input']>;
  last_image_url?: InputMaybe<Scalars['String']['input']>;
  last_text_message?: InputMaybe<Scalars['String']['input']>;
  product_id?: InputMaybe<Scalars['uuid']['input']>;
  updated_at?: InputMaybe<Scalars['timestamptz']['input']>;
  user_id?: InputMaybe<Scalars['String']['input']>;
};

/** Streaming cursor of the table "conversations" */
export type Conversations_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Conversations_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Conversations_Stream_Cursor_Value_Input = {
  created_at?: InputMaybe<Scalars['timestamptz']['input']>;
  id?: InputMaybe<Scalars['uuid']['input']>;
  last_image_url?: InputMaybe<Scalars['String']['input']>;
  last_text_message?: InputMaybe<Scalars['String']['input']>;
  product_id?: InputMaybe<Scalars['uuid']['input']>;
  updated_at?: InputMaybe<Scalars['timestamptz']['input']>;
  user_id?: InputMaybe<Scalars['String']['input']>;
};

/** update columns of table "conversations" */
export enum Conversations_Update_Column {
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  Id = 'id',
  /** column name */
  LastImageUrl = 'last_image_url',
  /** column name */
  LastTextMessage = 'last_text_message',
  /** column name */
  ProductId = 'product_id',
  /** column name */
  UpdatedAt = 'updated_at',
  /** column name */
  UserId = 'user_id'
}

export type Conversations_Updates = {
  /** sets the columns of the filtered rows to the given values */
  _set?: InputMaybe<Conversations_Set_Input>;
  /** filter the rows which have to be updated */
  where: Conversations_Bool_Exp;
};

/** ordering argument of a cursor */
export enum Cursor_Ordering {
  /** ascending ordering of the cursor */
  Asc = 'ASC',
  /** descending ordering of the cursor */
  Desc = 'DESC'
}

export type Jsonb_Cast_Exp = {
  String?: InputMaybe<String_Comparison_Exp>;
};

/** Boolean expression to compare columns of type "jsonb". All fields are combined with logical 'AND'. */
export type Jsonb_Comparison_Exp = {
  _cast?: InputMaybe<Jsonb_Cast_Exp>;
  /** is the column contained in the given json value */
  _contained_in?: InputMaybe<Scalars['jsonb']['input']>;
  /** does the column contain the given json value at the top level */
  _contains?: InputMaybe<Scalars['jsonb']['input']>;
  _eq?: InputMaybe<Scalars['jsonb']['input']>;
  _gt?: InputMaybe<Scalars['jsonb']['input']>;
  _gte?: InputMaybe<Scalars['jsonb']['input']>;
  /** does the string exist as a top-level key in the column */
  _has_key?: InputMaybe<Scalars['String']['input']>;
  /** do all of these strings exist as top-level keys in the column */
  _has_keys_all?: InputMaybe<Array<Scalars['String']['input']>>;
  /** do any of these strings exist as top-level keys in the column */
  _has_keys_any?: InputMaybe<Array<Scalars['String']['input']>>;
  _in?: InputMaybe<Array<Scalars['jsonb']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['jsonb']['input']>;
  _lte?: InputMaybe<Scalars['jsonb']['input']>;
  _neq?: InputMaybe<Scalars['jsonb']['input']>;
  _nin?: InputMaybe<Array<Scalars['jsonb']['input']>>;
};

/** columns and relationships of "message_medias" */
export type Message_Medias = {
  __typename?: 'message_medias';
  created_at: Scalars['timestamptz']['output'];
  id: Scalars['uuid']['output'];
  /** An object relationship */
  media_message?: Maybe<Messages>;
  media_url?: Maybe<Scalars['String']['output']>;
  message_id: Scalars['uuid']['output'];
  mime_type?: Maybe<Scalars['String']['output']>;
  updated_at: Scalars['timestamptz']['output'];
};

/** aggregated selection of "message_medias" */
export type Message_Medias_Aggregate = {
  __typename?: 'message_medias_aggregate';
  aggregate?: Maybe<Message_Medias_Aggregate_Fields>;
  nodes: Array<Message_Medias>;
};

export type Message_Medias_Aggregate_Bool_Exp = {
  count?: InputMaybe<Message_Medias_Aggregate_Bool_Exp_Count>;
};

export type Message_Medias_Aggregate_Bool_Exp_Count = {
  arguments?: InputMaybe<Array<Message_Medias_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
  filter?: InputMaybe<Message_Medias_Bool_Exp>;
  predicate: Int_Comparison_Exp;
};

/** aggregate fields of "message_medias" */
export type Message_Medias_Aggregate_Fields = {
  __typename?: 'message_medias_aggregate_fields';
  count: Scalars['Int']['output'];
  max?: Maybe<Message_Medias_Max_Fields>;
  min?: Maybe<Message_Medias_Min_Fields>;
};


/** aggregate fields of "message_medias" */
export type Message_Medias_Aggregate_FieldsCountArgs = {
  columns?: InputMaybe<Array<Message_Medias_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
};

/** order by aggregate values of table "message_medias" */
export type Message_Medias_Aggregate_Order_By = {
  count?: InputMaybe<Order_By>;
  max?: InputMaybe<Message_Medias_Max_Order_By>;
  min?: InputMaybe<Message_Medias_Min_Order_By>;
};

/** input type for inserting array relation for remote table "message_medias" */
export type Message_Medias_Arr_Rel_Insert_Input = {
  data: Array<Message_Medias_Insert_Input>;
  /** upsert condition */
  on_conflict?: InputMaybe<Message_Medias_On_Conflict>;
};

/** Boolean expression to filter rows from the table "message_medias". All fields are combined with a logical 'AND'. */
export type Message_Medias_Bool_Exp = {
  _and?: InputMaybe<Array<Message_Medias_Bool_Exp>>;
  _not?: InputMaybe<Message_Medias_Bool_Exp>;
  _or?: InputMaybe<Array<Message_Medias_Bool_Exp>>;
  created_at?: InputMaybe<Timestamptz_Comparison_Exp>;
  id?: InputMaybe<Uuid_Comparison_Exp>;
  media_message?: InputMaybe<Messages_Bool_Exp>;
  media_url?: InputMaybe<String_Comparison_Exp>;
  message_id?: InputMaybe<Uuid_Comparison_Exp>;
  mime_type?: InputMaybe<String_Comparison_Exp>;
  updated_at?: InputMaybe<Timestamptz_Comparison_Exp>;
};

/** unique or primary key constraints on table "message_medias" */
export enum Message_Medias_Constraint {
  /** unique or primary key constraint on columns "id" */
  MessageMediasPkey = 'message_medias_pkey'
}

/** input type for inserting data into table "message_medias" */
export type Message_Medias_Insert_Input = {
  created_at?: InputMaybe<Scalars['timestamptz']['input']>;
  id?: InputMaybe<Scalars['uuid']['input']>;
  media_message?: InputMaybe<Messages_Obj_Rel_Insert_Input>;
  media_url?: InputMaybe<Scalars['String']['input']>;
  message_id?: InputMaybe<Scalars['uuid']['input']>;
  mime_type?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamptz']['input']>;
};

/** aggregate max on columns */
export type Message_Medias_Max_Fields = {
  __typename?: 'message_medias_max_fields';
  created_at?: Maybe<Scalars['timestamptz']['output']>;
  id?: Maybe<Scalars['uuid']['output']>;
  media_url?: Maybe<Scalars['String']['output']>;
  message_id?: Maybe<Scalars['uuid']['output']>;
  mime_type?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamptz']['output']>;
};

/** order by max() on columns of table "message_medias" */
export type Message_Medias_Max_Order_By = {
  created_at?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  media_url?: InputMaybe<Order_By>;
  message_id?: InputMaybe<Order_By>;
  mime_type?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** aggregate min on columns */
export type Message_Medias_Min_Fields = {
  __typename?: 'message_medias_min_fields';
  created_at?: Maybe<Scalars['timestamptz']['output']>;
  id?: Maybe<Scalars['uuid']['output']>;
  media_url?: Maybe<Scalars['String']['output']>;
  message_id?: Maybe<Scalars['uuid']['output']>;
  mime_type?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamptz']['output']>;
};

/** order by min() on columns of table "message_medias" */
export type Message_Medias_Min_Order_By = {
  created_at?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  media_url?: InputMaybe<Order_By>;
  message_id?: InputMaybe<Order_By>;
  mime_type?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** response of any mutation on the table "message_medias" */
export type Message_Medias_Mutation_Response = {
  __typename?: 'message_medias_mutation_response';
  /** number of rows affected by the mutation */
  affected_rows: Scalars['Int']['output'];
  /** data from the rows affected by the mutation */
  returning: Array<Message_Medias>;
};

/** on_conflict condition type for table "message_medias" */
export type Message_Medias_On_Conflict = {
  constraint: Message_Medias_Constraint;
  update_columns?: Array<Message_Medias_Update_Column>;
  where?: InputMaybe<Message_Medias_Bool_Exp>;
};

/** Ordering options when selecting data from "message_medias". */
export type Message_Medias_Order_By = {
  created_at?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  media_message?: InputMaybe<Messages_Order_By>;
  media_url?: InputMaybe<Order_By>;
  message_id?: InputMaybe<Order_By>;
  mime_type?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** primary key columns input for table: message_medias */
export type Message_Medias_Pk_Columns_Input = {
  id: Scalars['uuid']['input'];
};

/** select columns of table "message_medias" */
export enum Message_Medias_Select_Column {
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  Id = 'id',
  /** column name */
  MediaUrl = 'media_url',
  /** column name */
  MessageId = 'message_id',
  /** column name */
  MimeType = 'mime_type',
  /** column name */
  UpdatedAt = 'updated_at'
}

/** input type for updating data in table "message_medias" */
export type Message_Medias_Set_Input = {
  created_at?: InputMaybe<Scalars['timestamptz']['input']>;
  id?: InputMaybe<Scalars['uuid']['input']>;
  media_url?: InputMaybe<Scalars['String']['input']>;
  message_id?: InputMaybe<Scalars['uuid']['input']>;
  mime_type?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamptz']['input']>;
};

/** Streaming cursor of the table "message_medias" */
export type Message_Medias_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Message_Medias_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Message_Medias_Stream_Cursor_Value_Input = {
  created_at?: InputMaybe<Scalars['timestamptz']['input']>;
  id?: InputMaybe<Scalars['uuid']['input']>;
  media_url?: InputMaybe<Scalars['String']['input']>;
  message_id?: InputMaybe<Scalars['uuid']['input']>;
  mime_type?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamptz']['input']>;
};

/** update columns of table "message_medias" */
export enum Message_Medias_Update_Column {
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  Id = 'id',
  /** column name */
  MediaUrl = 'media_url',
  /** column name */
  MessageId = 'message_id',
  /** column name */
  MimeType = 'mime_type',
  /** column name */
  UpdatedAt = 'updated_at'
}

export type Message_Medias_Updates = {
  /** sets the columns of the filtered rows to the given values */
  _set?: InputMaybe<Message_Medias_Set_Input>;
  /** filter the rows which have to be updated */
  where: Message_Medias_Bool_Exp;
};

/** columns and relationships of "messages" */
export type Messages = {
  __typename?: 'messages';
  content?: Maybe<Scalars['String']['output']>;
  conversation_id: Scalars['uuid']['output'];
  created_at: Scalars['timestamptz']['output'];
  id: Scalars['uuid']['output'];
  /** An object relationship */
  message_conversation?: Maybe<Conversations>;
  /** An array relationship */
  message_medias: Array<Message_Medias>;
  /** An aggregate relationship */
  message_medias_aggregate: Message_Medias_Aggregate;
  message_sender_type?: Maybe<Scalars['String']['output']>;
  message_type?: Maybe<Scalars['String']['output']>;
  prompt_cache?: Maybe<Scalars['jsonb']['output']>;
  sender: Scalars['String']['output'];
  sender_avatar_url?: Maybe<Scalars['String']['output']>;
  sender_name?: Maybe<Scalars['String']['output']>;
  status?: Maybe<Scalars['String']['output']>;
  updated_at: Scalars['timestamptz']['output'];
};


/** columns and relationships of "messages" */
export type MessagesMessage_MediasArgs = {
  distinct_on?: InputMaybe<Array<Message_Medias_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Message_Medias_Order_By>>;
  where?: InputMaybe<Message_Medias_Bool_Exp>;
};


/** columns and relationships of "messages" */
export type MessagesMessage_Medias_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Message_Medias_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Message_Medias_Order_By>>;
  where?: InputMaybe<Message_Medias_Bool_Exp>;
};


/** columns and relationships of "messages" */
export type MessagesPrompt_CacheArgs = {
  path?: InputMaybe<Scalars['String']['input']>;
};

/** aggregated selection of "messages" */
export type Messages_Aggregate = {
  __typename?: 'messages_aggregate';
  aggregate?: Maybe<Messages_Aggregate_Fields>;
  nodes: Array<Messages>;
};

export type Messages_Aggregate_Bool_Exp = {
  count?: InputMaybe<Messages_Aggregate_Bool_Exp_Count>;
};

export type Messages_Aggregate_Bool_Exp_Count = {
  arguments?: InputMaybe<Array<Messages_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
  filter?: InputMaybe<Messages_Bool_Exp>;
  predicate: Int_Comparison_Exp;
};

/** aggregate fields of "messages" */
export type Messages_Aggregate_Fields = {
  __typename?: 'messages_aggregate_fields';
  count: Scalars['Int']['output'];
  max?: Maybe<Messages_Max_Fields>;
  min?: Maybe<Messages_Min_Fields>;
};


/** aggregate fields of "messages" */
export type Messages_Aggregate_FieldsCountArgs = {
  columns?: InputMaybe<Array<Messages_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
};

/** order by aggregate values of table "messages" */
export type Messages_Aggregate_Order_By = {
  count?: InputMaybe<Order_By>;
  max?: InputMaybe<Messages_Max_Order_By>;
  min?: InputMaybe<Messages_Min_Order_By>;
};

/** append existing jsonb value of filtered columns with new jsonb value */
export type Messages_Append_Input = {
  prompt_cache?: InputMaybe<Scalars['jsonb']['input']>;
};

/** input type for inserting array relation for remote table "messages" */
export type Messages_Arr_Rel_Insert_Input = {
  data: Array<Messages_Insert_Input>;
  /** upsert condition */
  on_conflict?: InputMaybe<Messages_On_Conflict>;
};

/** Boolean expression to filter rows from the table "messages". All fields are combined with a logical 'AND'. */
export type Messages_Bool_Exp = {
  _and?: InputMaybe<Array<Messages_Bool_Exp>>;
  _not?: InputMaybe<Messages_Bool_Exp>;
  _or?: InputMaybe<Array<Messages_Bool_Exp>>;
  content?: InputMaybe<String_Comparison_Exp>;
  conversation_id?: InputMaybe<Uuid_Comparison_Exp>;
  created_at?: InputMaybe<Timestamptz_Comparison_Exp>;
  id?: InputMaybe<Uuid_Comparison_Exp>;
  message_conversation?: InputMaybe<Conversations_Bool_Exp>;
  message_medias?: InputMaybe<Message_Medias_Bool_Exp>;
  message_medias_aggregate?: InputMaybe<Message_Medias_Aggregate_Bool_Exp>;
  message_sender_type?: InputMaybe<String_Comparison_Exp>;
  message_type?: InputMaybe<String_Comparison_Exp>;
  prompt_cache?: InputMaybe<Jsonb_Comparison_Exp>;
  sender?: InputMaybe<String_Comparison_Exp>;
  sender_avatar_url?: InputMaybe<String_Comparison_Exp>;
  sender_name?: InputMaybe<String_Comparison_Exp>;
  status?: InputMaybe<String_Comparison_Exp>;
  updated_at?: InputMaybe<Timestamptz_Comparison_Exp>;
};

/** unique or primary key constraints on table "messages" */
export enum Messages_Constraint {
  /** unique or primary key constraint on columns "id" */
  MessagesPkey = 'messages_pkey'
}

/** delete the field or element with specified path (for JSON arrays, negative integers count from the end) */
export type Messages_Delete_At_Path_Input = {
  prompt_cache?: InputMaybe<Array<Scalars['String']['input']>>;
};

/** delete the array element with specified index (negative integers count from the end). throws an error if top level container is not an array */
export type Messages_Delete_Elem_Input = {
  prompt_cache?: InputMaybe<Scalars['Int']['input']>;
};

/** delete key/value pair or string element. key/value pairs are matched based on their key value */
export type Messages_Delete_Key_Input = {
  prompt_cache?: InputMaybe<Scalars['String']['input']>;
};

/** input type for inserting data into table "messages" */
export type Messages_Insert_Input = {
  content?: InputMaybe<Scalars['String']['input']>;
  conversation_id?: InputMaybe<Scalars['uuid']['input']>;
  created_at?: InputMaybe<Scalars['timestamptz']['input']>;
  id?: InputMaybe<Scalars['uuid']['input']>;
  message_conversation?: InputMaybe<Conversations_Obj_Rel_Insert_Input>;
  message_medias?: InputMaybe<Message_Medias_Arr_Rel_Insert_Input>;
  message_sender_type?: InputMaybe<Scalars['String']['input']>;
  message_type?: InputMaybe<Scalars['String']['input']>;
  prompt_cache?: InputMaybe<Scalars['jsonb']['input']>;
  sender?: InputMaybe<Scalars['String']['input']>;
  sender_avatar_url?: InputMaybe<Scalars['String']['input']>;
  sender_name?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamptz']['input']>;
};

/** aggregate max on columns */
export type Messages_Max_Fields = {
  __typename?: 'messages_max_fields';
  content?: Maybe<Scalars['String']['output']>;
  conversation_id?: Maybe<Scalars['uuid']['output']>;
  created_at?: Maybe<Scalars['timestamptz']['output']>;
  id?: Maybe<Scalars['uuid']['output']>;
  message_sender_type?: Maybe<Scalars['String']['output']>;
  message_type?: Maybe<Scalars['String']['output']>;
  sender?: Maybe<Scalars['String']['output']>;
  sender_avatar_url?: Maybe<Scalars['String']['output']>;
  sender_name?: Maybe<Scalars['String']['output']>;
  status?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamptz']['output']>;
};

/** order by max() on columns of table "messages" */
export type Messages_Max_Order_By = {
  content?: InputMaybe<Order_By>;
  conversation_id?: InputMaybe<Order_By>;
  created_at?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  message_sender_type?: InputMaybe<Order_By>;
  message_type?: InputMaybe<Order_By>;
  sender?: InputMaybe<Order_By>;
  sender_avatar_url?: InputMaybe<Order_By>;
  sender_name?: InputMaybe<Order_By>;
  status?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** aggregate min on columns */
export type Messages_Min_Fields = {
  __typename?: 'messages_min_fields';
  content?: Maybe<Scalars['String']['output']>;
  conversation_id?: Maybe<Scalars['uuid']['output']>;
  created_at?: Maybe<Scalars['timestamptz']['output']>;
  id?: Maybe<Scalars['uuid']['output']>;
  message_sender_type?: Maybe<Scalars['String']['output']>;
  message_type?: Maybe<Scalars['String']['output']>;
  sender?: Maybe<Scalars['String']['output']>;
  sender_avatar_url?: Maybe<Scalars['String']['output']>;
  sender_name?: Maybe<Scalars['String']['output']>;
  status?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamptz']['output']>;
};

/** order by min() on columns of table "messages" */
export type Messages_Min_Order_By = {
  content?: InputMaybe<Order_By>;
  conversation_id?: InputMaybe<Order_By>;
  created_at?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  message_sender_type?: InputMaybe<Order_By>;
  message_type?: InputMaybe<Order_By>;
  sender?: InputMaybe<Order_By>;
  sender_avatar_url?: InputMaybe<Order_By>;
  sender_name?: InputMaybe<Order_By>;
  status?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** response of any mutation on the table "messages" */
export type Messages_Mutation_Response = {
  __typename?: 'messages_mutation_response';
  /** number of rows affected by the mutation */
  affected_rows: Scalars['Int']['output'];
  /** data from the rows affected by the mutation */
  returning: Array<Messages>;
};

/** input type for inserting object relation for remote table "messages" */
export type Messages_Obj_Rel_Insert_Input = {
  data: Messages_Insert_Input;
  /** upsert condition */
  on_conflict?: InputMaybe<Messages_On_Conflict>;
};

/** on_conflict condition type for table "messages" */
export type Messages_On_Conflict = {
  constraint: Messages_Constraint;
  update_columns?: Array<Messages_Update_Column>;
  where?: InputMaybe<Messages_Bool_Exp>;
};

/** Ordering options when selecting data from "messages". */
export type Messages_Order_By = {
  content?: InputMaybe<Order_By>;
  conversation_id?: InputMaybe<Order_By>;
  created_at?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  message_conversation?: InputMaybe<Conversations_Order_By>;
  message_medias_aggregate?: InputMaybe<Message_Medias_Aggregate_Order_By>;
  message_sender_type?: InputMaybe<Order_By>;
  message_type?: InputMaybe<Order_By>;
  prompt_cache?: InputMaybe<Order_By>;
  sender?: InputMaybe<Order_By>;
  sender_avatar_url?: InputMaybe<Order_By>;
  sender_name?: InputMaybe<Order_By>;
  status?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** primary key columns input for table: messages */
export type Messages_Pk_Columns_Input = {
  id: Scalars['uuid']['input'];
};

/** prepend existing jsonb value of filtered columns with new jsonb value */
export type Messages_Prepend_Input = {
  prompt_cache?: InputMaybe<Scalars['jsonb']['input']>;
};

/** select columns of table "messages" */
export enum Messages_Select_Column {
  /** column name */
  Content = 'content',
  /** column name */
  ConversationId = 'conversation_id',
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  Id = 'id',
  /** column name */
  MessageSenderType = 'message_sender_type',
  /** column name */
  MessageType = 'message_type',
  /** column name */
  PromptCache = 'prompt_cache',
  /** column name */
  Sender = 'sender',
  /** column name */
  SenderAvatarUrl = 'sender_avatar_url',
  /** column name */
  SenderName = 'sender_name',
  /** column name */
  Status = 'status',
  /** column name */
  UpdatedAt = 'updated_at'
}

/** input type for updating data in table "messages" */
export type Messages_Set_Input = {
  content?: InputMaybe<Scalars['String']['input']>;
  conversation_id?: InputMaybe<Scalars['uuid']['input']>;
  created_at?: InputMaybe<Scalars['timestamptz']['input']>;
  id?: InputMaybe<Scalars['uuid']['input']>;
  message_sender_type?: InputMaybe<Scalars['String']['input']>;
  message_type?: InputMaybe<Scalars['String']['input']>;
  prompt_cache?: InputMaybe<Scalars['jsonb']['input']>;
  sender?: InputMaybe<Scalars['String']['input']>;
  sender_avatar_url?: InputMaybe<Scalars['String']['input']>;
  sender_name?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamptz']['input']>;
};

/** Streaming cursor of the table "messages" */
export type Messages_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Messages_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Messages_Stream_Cursor_Value_Input = {
  content?: InputMaybe<Scalars['String']['input']>;
  conversation_id?: InputMaybe<Scalars['uuid']['input']>;
  created_at?: InputMaybe<Scalars['timestamptz']['input']>;
  id?: InputMaybe<Scalars['uuid']['input']>;
  message_sender_type?: InputMaybe<Scalars['String']['input']>;
  message_type?: InputMaybe<Scalars['String']['input']>;
  prompt_cache?: InputMaybe<Scalars['jsonb']['input']>;
  sender?: InputMaybe<Scalars['String']['input']>;
  sender_avatar_url?: InputMaybe<Scalars['String']['input']>;
  sender_name?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamptz']['input']>;
};

/** update columns of table "messages" */
export enum Messages_Update_Column {
  /** column name */
  Content = 'content',
  /** column name */
  ConversationId = 'conversation_id',
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  Id = 'id',
  /** column name */
  MessageSenderType = 'message_sender_type',
  /** column name */
  MessageType = 'message_type',
  /** column name */
  PromptCache = 'prompt_cache',
  /** column name */
  Sender = 'sender',
  /** column name */
  SenderAvatarUrl = 'sender_avatar_url',
  /** column name */
  SenderName = 'sender_name',
  /** column name */
  Status = 'status',
  /** column name */
  UpdatedAt = 'updated_at'
}

export type Messages_Updates = {
  /** append existing jsonb value of filtered columns with new jsonb value */
  _append?: InputMaybe<Messages_Append_Input>;
  /** delete the field or element with specified path (for JSON arrays, negative integers count from the end) */
  _delete_at_path?: InputMaybe<Messages_Delete_At_Path_Input>;
  /** delete the array element with specified index (negative integers count from the end). throws an error if top level container is not an array */
  _delete_elem?: InputMaybe<Messages_Delete_Elem_Input>;
  /** delete key/value pair or string element. key/value pairs are matched based on their key value */
  _delete_key?: InputMaybe<Messages_Delete_Key_Input>;
  /** prepend existing jsonb value of filtered columns with new jsonb value */
  _prepend?: InputMaybe<Messages_Prepend_Input>;
  /** sets the columns of the filtered rows to the given values */
  _set?: InputMaybe<Messages_Set_Input>;
  /** filter the rows which have to be updated */
  where: Messages_Bool_Exp;
};

/** mutation root */
export type Mutation_Root = {
  __typename?: 'mutation_root';
  /** delete data from the table: "collection_products" */
  delete_collection_products?: Maybe<Collection_Products_Mutation_Response>;
  /** delete single row from the table: "collection_products" */
  delete_collection_products_by_pk?: Maybe<Collection_Products>;
  /** delete data from the table: "collections" */
  delete_collections?: Maybe<Collections_Mutation_Response>;
  /** delete single row from the table: "collections" */
  delete_collections_by_pk?: Maybe<Collections>;
  /** delete data from the table: "conversations" */
  delete_conversations?: Maybe<Conversations_Mutation_Response>;
  /** delete single row from the table: "conversations" */
  delete_conversations_by_pk?: Maybe<Conversations>;
  /** delete data from the table: "message_medias" */
  delete_message_medias?: Maybe<Message_Medias_Mutation_Response>;
  /** delete single row from the table: "message_medias" */
  delete_message_medias_by_pk?: Maybe<Message_Medias>;
  /** delete data from the table: "messages" */
  delete_messages?: Maybe<Messages_Mutation_Response>;
  /** delete single row from the table: "messages" */
  delete_messages_by_pk?: Maybe<Messages>;
  /** delete data from the table: "product_prompts" */
  delete_product_prompts?: Maybe<Product_Prompts_Mutation_Response>;
  /** delete single row from the table: "product_prompts" */
  delete_product_prompts_by_pk?: Maybe<Product_Prompts>;
  /** delete data from the table: "products" */
  delete_products?: Maybe<Products_Mutation_Response>;
  /** delete single row from the table: "products" */
  delete_products_by_pk?: Maybe<Products>;
  /** delete data from the table: "prompts" */
  delete_prompts?: Maybe<Prompts_Mutation_Response>;
  /** delete single row from the table: "prompts" */
  delete_prompts_by_pk?: Maybe<Prompts>;
  imageGeneration?: Maybe<ImageGenerationOutput>;
  /** insert data into the table: "collection_products" */
  insert_collection_products?: Maybe<Collection_Products_Mutation_Response>;
  /** insert a single row into the table: "collection_products" */
  insert_collection_products_one?: Maybe<Collection_Products>;
  /** insert data into the table: "collections" */
  insert_collections?: Maybe<Collections_Mutation_Response>;
  /** insert a single row into the table: "collections" */
  insert_collections_one?: Maybe<Collections>;
  /** insert data into the table: "conversations" */
  insert_conversations?: Maybe<Conversations_Mutation_Response>;
  /** insert a single row into the table: "conversations" */
  insert_conversations_one?: Maybe<Conversations>;
  /** insert data into the table: "message_medias" */
  insert_message_medias?: Maybe<Message_Medias_Mutation_Response>;
  /** insert a single row into the table: "message_medias" */
  insert_message_medias_one?: Maybe<Message_Medias>;
  /** insert data into the table: "messages" */
  insert_messages?: Maybe<Messages_Mutation_Response>;
  /** insert a single row into the table: "messages" */
  insert_messages_one?: Maybe<Messages>;
  /** insert data into the table: "product_prompts" */
  insert_product_prompts?: Maybe<Product_Prompts_Mutation_Response>;
  /** insert a single row into the table: "product_prompts" */
  insert_product_prompts_one?: Maybe<Product_Prompts>;
  /** insert data into the table: "products" */
  insert_products?: Maybe<Products_Mutation_Response>;
  /** insert a single row into the table: "products" */
  insert_products_one?: Maybe<Products>;
  /** insert data into the table: "prompts" */
  insert_prompts?: Maybe<Prompts_Mutation_Response>;
  /** insert a single row into the table: "prompts" */
  insert_prompts_one?: Maybe<Prompts>;
  /** update data of the table: "collection_products" */
  update_collection_products?: Maybe<Collection_Products_Mutation_Response>;
  /** update single row of the table: "collection_products" */
  update_collection_products_by_pk?: Maybe<Collection_Products>;
  /** update multiples rows of table: "collection_products" */
  update_collection_products_many?: Maybe<Array<Maybe<Collection_Products_Mutation_Response>>>;
  /** update data of the table: "collections" */
  update_collections?: Maybe<Collections_Mutation_Response>;
  /** update single row of the table: "collections" */
  update_collections_by_pk?: Maybe<Collections>;
  /** update multiples rows of table: "collections" */
  update_collections_many?: Maybe<Array<Maybe<Collections_Mutation_Response>>>;
  /** update data of the table: "conversations" */
  update_conversations?: Maybe<Conversations_Mutation_Response>;
  /** update single row of the table: "conversations" */
  update_conversations_by_pk?: Maybe<Conversations>;
  /** update multiples rows of table: "conversations" */
  update_conversations_many?: Maybe<Array<Maybe<Conversations_Mutation_Response>>>;
  /** update data of the table: "message_medias" */
  update_message_medias?: Maybe<Message_Medias_Mutation_Response>;
  /** update single row of the table: "message_medias" */
  update_message_medias_by_pk?: Maybe<Message_Medias>;
  /** update multiples rows of table: "message_medias" */
  update_message_medias_many?: Maybe<Array<Maybe<Message_Medias_Mutation_Response>>>;
  /** update data of the table: "messages" */
  update_messages?: Maybe<Messages_Mutation_Response>;
  /** update single row of the table: "messages" */
  update_messages_by_pk?: Maybe<Messages>;
  /** update multiples rows of table: "messages" */
  update_messages_many?: Maybe<Array<Maybe<Messages_Mutation_Response>>>;
  /** update data of the table: "product_prompts" */
  update_product_prompts?: Maybe<Product_Prompts_Mutation_Response>;
  /** update single row of the table: "product_prompts" */
  update_product_prompts_by_pk?: Maybe<Product_Prompts>;
  /** update multiples rows of table: "product_prompts" */
  update_product_prompts_many?: Maybe<Array<Maybe<Product_Prompts_Mutation_Response>>>;
  /** update data of the table: "products" */
  update_products?: Maybe<Products_Mutation_Response>;
  /** update single row of the table: "products" */
  update_products_by_pk?: Maybe<Products>;
  /** update multiples rows of table: "products" */
  update_products_many?: Maybe<Array<Maybe<Products_Mutation_Response>>>;
  /** update data of the table: "prompts" */
  update_prompts?: Maybe<Prompts_Mutation_Response>;
  /** update single row of the table: "prompts" */
  update_prompts_by_pk?: Maybe<Prompts>;
  /** update multiples rows of table: "prompts" */
  update_prompts_many?: Maybe<Array<Maybe<Prompts_Mutation_Response>>>;
};


/** mutation root */
export type Mutation_RootDelete_Collection_ProductsArgs = {
  where: Collection_Products_Bool_Exp;
};


/** mutation root */
export type Mutation_RootDelete_Collection_Products_By_PkArgs = {
  id: Scalars['uuid']['input'];
};


/** mutation root */
export type Mutation_RootDelete_CollectionsArgs = {
  where: Collections_Bool_Exp;
};


/** mutation root */
export type Mutation_RootDelete_Collections_By_PkArgs = {
  id: Scalars['uuid']['input'];
};


/** mutation root */
export type Mutation_RootDelete_ConversationsArgs = {
  where: Conversations_Bool_Exp;
};


/** mutation root */
export type Mutation_RootDelete_Conversations_By_PkArgs = {
  id: Scalars['uuid']['input'];
};


/** mutation root */
export type Mutation_RootDelete_Message_MediasArgs = {
  where: Message_Medias_Bool_Exp;
};


/** mutation root */
export type Mutation_RootDelete_Message_Medias_By_PkArgs = {
  id: Scalars['uuid']['input'];
};


/** mutation root */
export type Mutation_RootDelete_MessagesArgs = {
  where: Messages_Bool_Exp;
};


/** mutation root */
export type Mutation_RootDelete_Messages_By_PkArgs = {
  id: Scalars['uuid']['input'];
};


/** mutation root */
export type Mutation_RootDelete_Product_PromptsArgs = {
  where: Product_Prompts_Bool_Exp;
};


/** mutation root */
export type Mutation_RootDelete_Product_Prompts_By_PkArgs = {
  id: Scalars['uuid']['input'];
};


/** mutation root */
export type Mutation_RootDelete_ProductsArgs = {
  where: Products_Bool_Exp;
};


/** mutation root */
export type Mutation_RootDelete_Products_By_PkArgs = {
  id: Scalars['uuid']['input'];
};


/** mutation root */
export type Mutation_RootDelete_PromptsArgs = {
  where: Prompts_Bool_Exp;
};


/** mutation root */
export type Mutation_RootDelete_Prompts_By_PkArgs = {
  id: Scalars['uuid']['input'];
};


/** mutation root */
export type Mutation_RootImageGenerationArgs = {
  input: ImageGenerationInput;
};


/** mutation root */
export type Mutation_RootInsert_Collection_ProductsArgs = {
  objects: Array<Collection_Products_Insert_Input>;
  on_conflict?: InputMaybe<Collection_Products_On_Conflict>;
};


/** mutation root */
export type Mutation_RootInsert_Collection_Products_OneArgs = {
  object: Collection_Products_Insert_Input;
  on_conflict?: InputMaybe<Collection_Products_On_Conflict>;
};


/** mutation root */
export type Mutation_RootInsert_CollectionsArgs = {
  objects: Array<Collections_Insert_Input>;
  on_conflict?: InputMaybe<Collections_On_Conflict>;
};


/** mutation root */
export type Mutation_RootInsert_Collections_OneArgs = {
  object: Collections_Insert_Input;
  on_conflict?: InputMaybe<Collections_On_Conflict>;
};


/** mutation root */
export type Mutation_RootInsert_ConversationsArgs = {
  objects: Array<Conversations_Insert_Input>;
  on_conflict?: InputMaybe<Conversations_On_Conflict>;
};


/** mutation root */
export type Mutation_RootInsert_Conversations_OneArgs = {
  object: Conversations_Insert_Input;
  on_conflict?: InputMaybe<Conversations_On_Conflict>;
};


/** mutation root */
export type Mutation_RootInsert_Message_MediasArgs = {
  objects: Array<Message_Medias_Insert_Input>;
  on_conflict?: InputMaybe<Message_Medias_On_Conflict>;
};


/** mutation root */
export type Mutation_RootInsert_Message_Medias_OneArgs = {
  object: Message_Medias_Insert_Input;
  on_conflict?: InputMaybe<Message_Medias_On_Conflict>;
};


/** mutation root */
export type Mutation_RootInsert_MessagesArgs = {
  objects: Array<Messages_Insert_Input>;
  on_conflict?: InputMaybe<Messages_On_Conflict>;
};


/** mutation root */
export type Mutation_RootInsert_Messages_OneArgs = {
  object: Messages_Insert_Input;
  on_conflict?: InputMaybe<Messages_On_Conflict>;
};


/** mutation root */
export type Mutation_RootInsert_Product_PromptsArgs = {
  objects: Array<Product_Prompts_Insert_Input>;
  on_conflict?: InputMaybe<Product_Prompts_On_Conflict>;
};


/** mutation root */
export type Mutation_RootInsert_Product_Prompts_OneArgs = {
  object: Product_Prompts_Insert_Input;
  on_conflict?: InputMaybe<Product_Prompts_On_Conflict>;
};


/** mutation root */
export type Mutation_RootInsert_ProductsArgs = {
  objects: Array<Products_Insert_Input>;
  on_conflict?: InputMaybe<Products_On_Conflict>;
};


/** mutation root */
export type Mutation_RootInsert_Products_OneArgs = {
  object: Products_Insert_Input;
  on_conflict?: InputMaybe<Products_On_Conflict>;
};


/** mutation root */
export type Mutation_RootInsert_PromptsArgs = {
  objects: Array<Prompts_Insert_Input>;
  on_conflict?: InputMaybe<Prompts_On_Conflict>;
};


/** mutation root */
export type Mutation_RootInsert_Prompts_OneArgs = {
  object: Prompts_Insert_Input;
  on_conflict?: InputMaybe<Prompts_On_Conflict>;
};


/** mutation root */
export type Mutation_RootUpdate_Collection_ProductsArgs = {
  _set?: InputMaybe<Collection_Products_Set_Input>;
  where: Collection_Products_Bool_Exp;
};


/** mutation root */
export type Mutation_RootUpdate_Collection_Products_By_PkArgs = {
  _set?: InputMaybe<Collection_Products_Set_Input>;
  pk_columns: Collection_Products_Pk_Columns_Input;
};


/** mutation root */
export type Mutation_RootUpdate_Collection_Products_ManyArgs = {
  updates: Array<Collection_Products_Updates>;
};


/** mutation root */
export type Mutation_RootUpdate_CollectionsArgs = {
  _set?: InputMaybe<Collections_Set_Input>;
  where: Collections_Bool_Exp;
};


/** mutation root */
export type Mutation_RootUpdate_Collections_By_PkArgs = {
  _set?: InputMaybe<Collections_Set_Input>;
  pk_columns: Collections_Pk_Columns_Input;
};


/** mutation root */
export type Mutation_RootUpdate_Collections_ManyArgs = {
  updates: Array<Collections_Updates>;
};


/** mutation root */
export type Mutation_RootUpdate_ConversationsArgs = {
  _set?: InputMaybe<Conversations_Set_Input>;
  where: Conversations_Bool_Exp;
};


/** mutation root */
export type Mutation_RootUpdate_Conversations_By_PkArgs = {
  _set?: InputMaybe<Conversations_Set_Input>;
  pk_columns: Conversations_Pk_Columns_Input;
};


/** mutation root */
export type Mutation_RootUpdate_Conversations_ManyArgs = {
  updates: Array<Conversations_Updates>;
};


/** mutation root */
export type Mutation_RootUpdate_Message_MediasArgs = {
  _set?: InputMaybe<Message_Medias_Set_Input>;
  where: Message_Medias_Bool_Exp;
};


/** mutation root */
export type Mutation_RootUpdate_Message_Medias_By_PkArgs = {
  _set?: InputMaybe<Message_Medias_Set_Input>;
  pk_columns: Message_Medias_Pk_Columns_Input;
};


/** mutation root */
export type Mutation_RootUpdate_Message_Medias_ManyArgs = {
  updates: Array<Message_Medias_Updates>;
};


/** mutation root */
export type Mutation_RootUpdate_MessagesArgs = {
  _append?: InputMaybe<Messages_Append_Input>;
  _delete_at_path?: InputMaybe<Messages_Delete_At_Path_Input>;
  _delete_elem?: InputMaybe<Messages_Delete_Elem_Input>;
  _delete_key?: InputMaybe<Messages_Delete_Key_Input>;
  _prepend?: InputMaybe<Messages_Prepend_Input>;
  _set?: InputMaybe<Messages_Set_Input>;
  where: Messages_Bool_Exp;
};


/** mutation root */
export type Mutation_RootUpdate_Messages_By_PkArgs = {
  _append?: InputMaybe<Messages_Append_Input>;
  _delete_at_path?: InputMaybe<Messages_Delete_At_Path_Input>;
  _delete_elem?: InputMaybe<Messages_Delete_Elem_Input>;
  _delete_key?: InputMaybe<Messages_Delete_Key_Input>;
  _prepend?: InputMaybe<Messages_Prepend_Input>;
  _set?: InputMaybe<Messages_Set_Input>;
  pk_columns: Messages_Pk_Columns_Input;
};


/** mutation root */
export type Mutation_RootUpdate_Messages_ManyArgs = {
  updates: Array<Messages_Updates>;
};


/** mutation root */
export type Mutation_RootUpdate_Product_PromptsArgs = {
  _set?: InputMaybe<Product_Prompts_Set_Input>;
  where: Product_Prompts_Bool_Exp;
};


/** mutation root */
export type Mutation_RootUpdate_Product_Prompts_By_PkArgs = {
  _set?: InputMaybe<Product_Prompts_Set_Input>;
  pk_columns: Product_Prompts_Pk_Columns_Input;
};


/** mutation root */
export type Mutation_RootUpdate_Product_Prompts_ManyArgs = {
  updates: Array<Product_Prompts_Updates>;
};


/** mutation root */
export type Mutation_RootUpdate_ProductsArgs = {
  _append?: InputMaybe<Products_Append_Input>;
  _delete_at_path?: InputMaybe<Products_Delete_At_Path_Input>;
  _delete_elem?: InputMaybe<Products_Delete_Elem_Input>;
  _delete_key?: InputMaybe<Products_Delete_Key_Input>;
  _prepend?: InputMaybe<Products_Prepend_Input>;
  _set?: InputMaybe<Products_Set_Input>;
  where: Products_Bool_Exp;
};


/** mutation root */
export type Mutation_RootUpdate_Products_By_PkArgs = {
  _append?: InputMaybe<Products_Append_Input>;
  _delete_at_path?: InputMaybe<Products_Delete_At_Path_Input>;
  _delete_elem?: InputMaybe<Products_Delete_Elem_Input>;
  _delete_key?: InputMaybe<Products_Delete_Key_Input>;
  _prepend?: InputMaybe<Products_Prepend_Input>;
  _set?: InputMaybe<Products_Set_Input>;
  pk_columns: Products_Pk_Columns_Input;
};


/** mutation root */
export type Mutation_RootUpdate_Products_ManyArgs = {
  updates: Array<Products_Updates>;
};


/** mutation root */
export type Mutation_RootUpdate_PromptsArgs = {
  _set?: InputMaybe<Prompts_Set_Input>;
  where: Prompts_Bool_Exp;
};


/** mutation root */
export type Mutation_RootUpdate_Prompts_By_PkArgs = {
  _set?: InputMaybe<Prompts_Set_Input>;
  pk_columns: Prompts_Pk_Columns_Input;
};


/** mutation root */
export type Mutation_RootUpdate_Prompts_ManyArgs = {
  updates: Array<Prompts_Updates>;
};

/** column ordering options */
export enum Order_By {
  /** in ascending order, nulls last */
  Asc = 'asc',
  /** in ascending order, nulls first */
  AscNullsFirst = 'asc_nulls_first',
  /** in ascending order, nulls last */
  AscNullsLast = 'asc_nulls_last',
  /** in descending order, nulls first */
  Desc = 'desc',
  /** in descending order, nulls first */
  DescNullsFirst = 'desc_nulls_first',
  /** in descending order, nulls last */
  DescNullsLast = 'desc_nulls_last'
}

/** columns and relationships of "product_prompts" */
export type Product_Prompts = {
  __typename?: 'product_prompts';
  created_at: Scalars['timestamptz']['output'];
  id: Scalars['uuid']['output'];
  product_id: Scalars['uuid']['output'];
  /** An array relationship */
  products: Array<Products>;
  /** An aggregate relationship */
  products_aggregate: Products_Aggregate;
  prompt_id: Scalars['uuid']['output'];
  /** An array relationship */
  prompts: Array<Prompts>;
  /** An aggregate relationship */
  prompts_aggregate: Prompts_Aggregate;
  updated_at: Scalars['timestamptz']['output'];
};


/** columns and relationships of "product_prompts" */
export type Product_PromptsProductsArgs = {
  distinct_on?: InputMaybe<Array<Products_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Products_Order_By>>;
  where?: InputMaybe<Products_Bool_Exp>;
};


/** columns and relationships of "product_prompts" */
export type Product_PromptsProducts_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Products_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Products_Order_By>>;
  where?: InputMaybe<Products_Bool_Exp>;
};


/** columns and relationships of "product_prompts" */
export type Product_PromptsPromptsArgs = {
  distinct_on?: InputMaybe<Array<Prompts_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Prompts_Order_By>>;
  where?: InputMaybe<Prompts_Bool_Exp>;
};


/** columns and relationships of "product_prompts" */
export type Product_PromptsPrompts_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Prompts_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Prompts_Order_By>>;
  where?: InputMaybe<Prompts_Bool_Exp>;
};

/** aggregated selection of "product_prompts" */
export type Product_Prompts_Aggregate = {
  __typename?: 'product_prompts_aggregate';
  aggregate?: Maybe<Product_Prompts_Aggregate_Fields>;
  nodes: Array<Product_Prompts>;
};

export type Product_Prompts_Aggregate_Bool_Exp = {
  count?: InputMaybe<Product_Prompts_Aggregate_Bool_Exp_Count>;
};

export type Product_Prompts_Aggregate_Bool_Exp_Count = {
  arguments?: InputMaybe<Array<Product_Prompts_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
  filter?: InputMaybe<Product_Prompts_Bool_Exp>;
  predicate: Int_Comparison_Exp;
};

/** aggregate fields of "product_prompts" */
export type Product_Prompts_Aggregate_Fields = {
  __typename?: 'product_prompts_aggregate_fields';
  count: Scalars['Int']['output'];
  max?: Maybe<Product_Prompts_Max_Fields>;
  min?: Maybe<Product_Prompts_Min_Fields>;
};


/** aggregate fields of "product_prompts" */
export type Product_Prompts_Aggregate_FieldsCountArgs = {
  columns?: InputMaybe<Array<Product_Prompts_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
};

/** order by aggregate values of table "product_prompts" */
export type Product_Prompts_Aggregate_Order_By = {
  count?: InputMaybe<Order_By>;
  max?: InputMaybe<Product_Prompts_Max_Order_By>;
  min?: InputMaybe<Product_Prompts_Min_Order_By>;
};

/** input type for inserting array relation for remote table "product_prompts" */
export type Product_Prompts_Arr_Rel_Insert_Input = {
  data: Array<Product_Prompts_Insert_Input>;
  /** upsert condition */
  on_conflict?: InputMaybe<Product_Prompts_On_Conflict>;
};

/** Boolean expression to filter rows from the table "product_prompts". All fields are combined with a logical 'AND'. */
export type Product_Prompts_Bool_Exp = {
  _and?: InputMaybe<Array<Product_Prompts_Bool_Exp>>;
  _not?: InputMaybe<Product_Prompts_Bool_Exp>;
  _or?: InputMaybe<Array<Product_Prompts_Bool_Exp>>;
  created_at?: InputMaybe<Timestamptz_Comparison_Exp>;
  id?: InputMaybe<Uuid_Comparison_Exp>;
  product_id?: InputMaybe<Uuid_Comparison_Exp>;
  products?: InputMaybe<Products_Bool_Exp>;
  products_aggregate?: InputMaybe<Products_Aggregate_Bool_Exp>;
  prompt_id?: InputMaybe<Uuid_Comparison_Exp>;
  prompts?: InputMaybe<Prompts_Bool_Exp>;
  prompts_aggregate?: InputMaybe<Prompts_Aggregate_Bool_Exp>;
  updated_at?: InputMaybe<Timestamptz_Comparison_Exp>;
};

/** unique or primary key constraints on table "product_prompts" */
export enum Product_Prompts_Constraint {
  /** unique or primary key constraint on columns "id" */
  ProductPromptsPkey = 'product_prompts_pkey',
  /** unique or primary key constraint on columns "product_id", "prompt_id" */
  ProductPromptsProductIdPromptIdKey = 'product_prompts_product_id_prompt_id_key'
}

/** input type for inserting data into table "product_prompts" */
export type Product_Prompts_Insert_Input = {
  created_at?: InputMaybe<Scalars['timestamptz']['input']>;
  id?: InputMaybe<Scalars['uuid']['input']>;
  product_id?: InputMaybe<Scalars['uuid']['input']>;
  products?: InputMaybe<Products_Arr_Rel_Insert_Input>;
  prompt_id?: InputMaybe<Scalars['uuid']['input']>;
  prompts?: InputMaybe<Prompts_Arr_Rel_Insert_Input>;
  updated_at?: InputMaybe<Scalars['timestamptz']['input']>;
};

/** aggregate max on columns */
export type Product_Prompts_Max_Fields = {
  __typename?: 'product_prompts_max_fields';
  created_at?: Maybe<Scalars['timestamptz']['output']>;
  id?: Maybe<Scalars['uuid']['output']>;
  product_id?: Maybe<Scalars['uuid']['output']>;
  prompt_id?: Maybe<Scalars['uuid']['output']>;
  updated_at?: Maybe<Scalars['timestamptz']['output']>;
};

/** order by max() on columns of table "product_prompts" */
export type Product_Prompts_Max_Order_By = {
  created_at?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  product_id?: InputMaybe<Order_By>;
  prompt_id?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** aggregate min on columns */
export type Product_Prompts_Min_Fields = {
  __typename?: 'product_prompts_min_fields';
  created_at?: Maybe<Scalars['timestamptz']['output']>;
  id?: Maybe<Scalars['uuid']['output']>;
  product_id?: Maybe<Scalars['uuid']['output']>;
  prompt_id?: Maybe<Scalars['uuid']['output']>;
  updated_at?: Maybe<Scalars['timestamptz']['output']>;
};

/** order by min() on columns of table "product_prompts" */
export type Product_Prompts_Min_Order_By = {
  created_at?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  product_id?: InputMaybe<Order_By>;
  prompt_id?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** response of any mutation on the table "product_prompts" */
export type Product_Prompts_Mutation_Response = {
  __typename?: 'product_prompts_mutation_response';
  /** number of rows affected by the mutation */
  affected_rows: Scalars['Int']['output'];
  /** data from the rows affected by the mutation */
  returning: Array<Product_Prompts>;
};

/** on_conflict condition type for table "product_prompts" */
export type Product_Prompts_On_Conflict = {
  constraint: Product_Prompts_Constraint;
  update_columns?: Array<Product_Prompts_Update_Column>;
  where?: InputMaybe<Product_Prompts_Bool_Exp>;
};

/** Ordering options when selecting data from "product_prompts". */
export type Product_Prompts_Order_By = {
  created_at?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  product_id?: InputMaybe<Order_By>;
  products_aggregate?: InputMaybe<Products_Aggregate_Order_By>;
  prompt_id?: InputMaybe<Order_By>;
  prompts_aggregate?: InputMaybe<Prompts_Aggregate_Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** primary key columns input for table: product_prompts */
export type Product_Prompts_Pk_Columns_Input = {
  id: Scalars['uuid']['input'];
};

/** select columns of table "product_prompts" */
export enum Product_Prompts_Select_Column {
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  Id = 'id',
  /** column name */
  ProductId = 'product_id',
  /** column name */
  PromptId = 'prompt_id',
  /** column name */
  UpdatedAt = 'updated_at'
}

/** input type for updating data in table "product_prompts" */
export type Product_Prompts_Set_Input = {
  created_at?: InputMaybe<Scalars['timestamptz']['input']>;
  id?: InputMaybe<Scalars['uuid']['input']>;
  product_id?: InputMaybe<Scalars['uuid']['input']>;
  prompt_id?: InputMaybe<Scalars['uuid']['input']>;
  updated_at?: InputMaybe<Scalars['timestamptz']['input']>;
};

/** Streaming cursor of the table "product_prompts" */
export type Product_Prompts_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Product_Prompts_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Product_Prompts_Stream_Cursor_Value_Input = {
  created_at?: InputMaybe<Scalars['timestamptz']['input']>;
  id?: InputMaybe<Scalars['uuid']['input']>;
  product_id?: InputMaybe<Scalars['uuid']['input']>;
  prompt_id?: InputMaybe<Scalars['uuid']['input']>;
  updated_at?: InputMaybe<Scalars['timestamptz']['input']>;
};

/** update columns of table "product_prompts" */
export enum Product_Prompts_Update_Column {
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  Id = 'id',
  /** column name */
  ProductId = 'product_id',
  /** column name */
  PromptId = 'prompt_id',
  /** column name */
  UpdatedAt = 'updated_at'
}

export type Product_Prompts_Updates = {
  /** sets the columns of the filtered rows to the given values */
  _set?: InputMaybe<Product_Prompts_Set_Input>;
  /** filter the rows which have to be updated */
  where: Product_Prompts_Bool_Exp;
};

/** columns and relationships of "products" */
export type Products = {
  __typename?: 'products';
  author?: Maybe<Scalars['String']['output']>;
  created_at: Scalars['timestamptz']['output'];
  description?: Maybe<Scalars['String']['output']>;
  greeting?: Maybe<Scalars['String']['output']>;
  id: Scalars['uuid']['output'];
  image_url?: Maybe<Scalars['String']['output']>;
  inputs?: Maybe<Scalars['jsonb']['output']>;
  long_description?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  nsfw: Scalars['Boolean']['output'];
  outputs?: Maybe<Scalars['jsonb']['output']>;
  /** An array relationship */
  product_collections: Array<Collection_Products>;
  /** An aggregate relationship */
  product_collections_aggregate: Collection_Products_Aggregate;
  /** An array relationship */
  product_prompts: Array<Product_Prompts>;
  /** An aggregate relationship */
  product_prompts_aggregate: Product_Prompts_Aggregate;
  slug: Scalars['String']['output'];
  source_url?: Maybe<Scalars['String']['output']>;
  technical_description?: Maybe<Scalars['String']['output']>;
  updated_at: Scalars['timestamptz']['output'];
  version?: Maybe<Scalars['String']['output']>;
};


/** columns and relationships of "products" */
export type ProductsInputsArgs = {
  path?: InputMaybe<Scalars['String']['input']>;
};


/** columns and relationships of "products" */
export type ProductsOutputsArgs = {
  path?: InputMaybe<Scalars['String']['input']>;
};


/** columns and relationships of "products" */
export type ProductsProduct_CollectionsArgs = {
  distinct_on?: InputMaybe<Array<Collection_Products_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Collection_Products_Order_By>>;
  where?: InputMaybe<Collection_Products_Bool_Exp>;
};


/** columns and relationships of "products" */
export type ProductsProduct_Collections_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Collection_Products_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Collection_Products_Order_By>>;
  where?: InputMaybe<Collection_Products_Bool_Exp>;
};


/** columns and relationships of "products" */
export type ProductsProduct_PromptsArgs = {
  distinct_on?: InputMaybe<Array<Product_Prompts_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Product_Prompts_Order_By>>;
  where?: InputMaybe<Product_Prompts_Bool_Exp>;
};


/** columns and relationships of "products" */
export type ProductsProduct_Prompts_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Product_Prompts_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Product_Prompts_Order_By>>;
  where?: InputMaybe<Product_Prompts_Bool_Exp>;
};

/** aggregated selection of "products" */
export type Products_Aggregate = {
  __typename?: 'products_aggregate';
  aggregate?: Maybe<Products_Aggregate_Fields>;
  nodes: Array<Products>;
};

export type Products_Aggregate_Bool_Exp = {
  bool_and?: InputMaybe<Products_Aggregate_Bool_Exp_Bool_And>;
  bool_or?: InputMaybe<Products_Aggregate_Bool_Exp_Bool_Or>;
  count?: InputMaybe<Products_Aggregate_Bool_Exp_Count>;
};

export type Products_Aggregate_Bool_Exp_Bool_And = {
  arguments: Products_Select_Column_Products_Aggregate_Bool_Exp_Bool_And_Arguments_Columns;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
  filter?: InputMaybe<Products_Bool_Exp>;
  predicate: Boolean_Comparison_Exp;
};

export type Products_Aggregate_Bool_Exp_Bool_Or = {
  arguments: Products_Select_Column_Products_Aggregate_Bool_Exp_Bool_Or_Arguments_Columns;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
  filter?: InputMaybe<Products_Bool_Exp>;
  predicate: Boolean_Comparison_Exp;
};

export type Products_Aggregate_Bool_Exp_Count = {
  arguments?: InputMaybe<Array<Products_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
  filter?: InputMaybe<Products_Bool_Exp>;
  predicate: Int_Comparison_Exp;
};

/** aggregate fields of "products" */
export type Products_Aggregate_Fields = {
  __typename?: 'products_aggregate_fields';
  count: Scalars['Int']['output'];
  max?: Maybe<Products_Max_Fields>;
  min?: Maybe<Products_Min_Fields>;
};


/** aggregate fields of "products" */
export type Products_Aggregate_FieldsCountArgs = {
  columns?: InputMaybe<Array<Products_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
};

/** order by aggregate values of table "products" */
export type Products_Aggregate_Order_By = {
  count?: InputMaybe<Order_By>;
  max?: InputMaybe<Products_Max_Order_By>;
  min?: InputMaybe<Products_Min_Order_By>;
};

/** append existing jsonb value of filtered columns with new jsonb value */
export type Products_Append_Input = {
  inputs?: InputMaybe<Scalars['jsonb']['input']>;
  outputs?: InputMaybe<Scalars['jsonb']['input']>;
};

/** input type for inserting array relation for remote table "products" */
export type Products_Arr_Rel_Insert_Input = {
  data: Array<Products_Insert_Input>;
  /** upsert condition */
  on_conflict?: InputMaybe<Products_On_Conflict>;
};

/** Boolean expression to filter rows from the table "products". All fields are combined with a logical 'AND'. */
export type Products_Bool_Exp = {
  _and?: InputMaybe<Array<Products_Bool_Exp>>;
  _not?: InputMaybe<Products_Bool_Exp>;
  _or?: InputMaybe<Array<Products_Bool_Exp>>;
  author?: InputMaybe<String_Comparison_Exp>;
  created_at?: InputMaybe<Timestamptz_Comparison_Exp>;
  description?: InputMaybe<String_Comparison_Exp>;
  greeting?: InputMaybe<String_Comparison_Exp>;
  id?: InputMaybe<Uuid_Comparison_Exp>;
  image_url?: InputMaybe<String_Comparison_Exp>;
  inputs?: InputMaybe<Jsonb_Comparison_Exp>;
  long_description?: InputMaybe<String_Comparison_Exp>;
  name?: InputMaybe<String_Comparison_Exp>;
  nsfw?: InputMaybe<Boolean_Comparison_Exp>;
  outputs?: InputMaybe<Jsonb_Comparison_Exp>;
  product_collections?: InputMaybe<Collection_Products_Bool_Exp>;
  product_collections_aggregate?: InputMaybe<Collection_Products_Aggregate_Bool_Exp>;
  product_prompts?: InputMaybe<Product_Prompts_Bool_Exp>;
  product_prompts_aggregate?: InputMaybe<Product_Prompts_Aggregate_Bool_Exp>;
  slug?: InputMaybe<String_Comparison_Exp>;
  source_url?: InputMaybe<String_Comparison_Exp>;
  technical_description?: InputMaybe<String_Comparison_Exp>;
  updated_at?: InputMaybe<Timestamptz_Comparison_Exp>;
  version?: InputMaybe<String_Comparison_Exp>;
};

/** unique or primary key constraints on table "products" */
export enum Products_Constraint {
  /** unique or primary key constraint on columns "id" */
  ProductsPkey = 'products_pkey',
  /** unique or primary key constraint on columns "slug" */
  ProductsSlugKey = 'products_slug_key'
}

/** delete the field or element with specified path (for JSON arrays, negative integers count from the end) */
export type Products_Delete_At_Path_Input = {
  inputs?: InputMaybe<Array<Scalars['String']['input']>>;
  outputs?: InputMaybe<Array<Scalars['String']['input']>>;
};

/** delete the array element with specified index (negative integers count from the end). throws an error if top level container is not an array */
export type Products_Delete_Elem_Input = {
  inputs?: InputMaybe<Scalars['Int']['input']>;
  outputs?: InputMaybe<Scalars['Int']['input']>;
};

/** delete key/value pair or string element. key/value pairs are matched based on their key value */
export type Products_Delete_Key_Input = {
  inputs?: InputMaybe<Scalars['String']['input']>;
  outputs?: InputMaybe<Scalars['String']['input']>;
};

/** input type for inserting data into table "products" */
export type Products_Insert_Input = {
  author?: InputMaybe<Scalars['String']['input']>;
  created_at?: InputMaybe<Scalars['timestamptz']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  greeting?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['uuid']['input']>;
  image_url?: InputMaybe<Scalars['String']['input']>;
  inputs?: InputMaybe<Scalars['jsonb']['input']>;
  long_description?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  nsfw?: InputMaybe<Scalars['Boolean']['input']>;
  outputs?: InputMaybe<Scalars['jsonb']['input']>;
  product_collections?: InputMaybe<Collection_Products_Arr_Rel_Insert_Input>;
  product_prompts?: InputMaybe<Product_Prompts_Arr_Rel_Insert_Input>;
  slug?: InputMaybe<Scalars['String']['input']>;
  source_url?: InputMaybe<Scalars['String']['input']>;
  technical_description?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamptz']['input']>;
  version?: InputMaybe<Scalars['String']['input']>;
};

/** aggregate max on columns */
export type Products_Max_Fields = {
  __typename?: 'products_max_fields';
  author?: Maybe<Scalars['String']['output']>;
  created_at?: Maybe<Scalars['timestamptz']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  greeting?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['uuid']['output']>;
  image_url?: Maybe<Scalars['String']['output']>;
  long_description?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  slug?: Maybe<Scalars['String']['output']>;
  source_url?: Maybe<Scalars['String']['output']>;
  technical_description?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamptz']['output']>;
  version?: Maybe<Scalars['String']['output']>;
};

/** order by max() on columns of table "products" */
export type Products_Max_Order_By = {
  author?: InputMaybe<Order_By>;
  created_at?: InputMaybe<Order_By>;
  description?: InputMaybe<Order_By>;
  greeting?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  image_url?: InputMaybe<Order_By>;
  long_description?: InputMaybe<Order_By>;
  name?: InputMaybe<Order_By>;
  slug?: InputMaybe<Order_By>;
  source_url?: InputMaybe<Order_By>;
  technical_description?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
  version?: InputMaybe<Order_By>;
};

/** aggregate min on columns */
export type Products_Min_Fields = {
  __typename?: 'products_min_fields';
  author?: Maybe<Scalars['String']['output']>;
  created_at?: Maybe<Scalars['timestamptz']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  greeting?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['uuid']['output']>;
  image_url?: Maybe<Scalars['String']['output']>;
  long_description?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  slug?: Maybe<Scalars['String']['output']>;
  source_url?: Maybe<Scalars['String']['output']>;
  technical_description?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamptz']['output']>;
  version?: Maybe<Scalars['String']['output']>;
};

/** order by min() on columns of table "products" */
export type Products_Min_Order_By = {
  author?: InputMaybe<Order_By>;
  created_at?: InputMaybe<Order_By>;
  description?: InputMaybe<Order_By>;
  greeting?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  image_url?: InputMaybe<Order_By>;
  long_description?: InputMaybe<Order_By>;
  name?: InputMaybe<Order_By>;
  slug?: InputMaybe<Order_By>;
  source_url?: InputMaybe<Order_By>;
  technical_description?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
  version?: InputMaybe<Order_By>;
};

/** response of any mutation on the table "products" */
export type Products_Mutation_Response = {
  __typename?: 'products_mutation_response';
  /** number of rows affected by the mutation */
  affected_rows: Scalars['Int']['output'];
  /** data from the rows affected by the mutation */
  returning: Array<Products>;
};

/** input type for inserting object relation for remote table "products" */
export type Products_Obj_Rel_Insert_Input = {
  data: Products_Insert_Input;
  /** upsert condition */
  on_conflict?: InputMaybe<Products_On_Conflict>;
};

/** on_conflict condition type for table "products" */
export type Products_On_Conflict = {
  constraint: Products_Constraint;
  update_columns?: Array<Products_Update_Column>;
  where?: InputMaybe<Products_Bool_Exp>;
};

/** Ordering options when selecting data from "products". */
export type Products_Order_By = {
  author?: InputMaybe<Order_By>;
  created_at?: InputMaybe<Order_By>;
  description?: InputMaybe<Order_By>;
  greeting?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  image_url?: InputMaybe<Order_By>;
  inputs?: InputMaybe<Order_By>;
  long_description?: InputMaybe<Order_By>;
  name?: InputMaybe<Order_By>;
  nsfw?: InputMaybe<Order_By>;
  outputs?: InputMaybe<Order_By>;
  product_collections_aggregate?: InputMaybe<Collection_Products_Aggregate_Order_By>;
  product_prompts_aggregate?: InputMaybe<Product_Prompts_Aggregate_Order_By>;
  slug?: InputMaybe<Order_By>;
  source_url?: InputMaybe<Order_By>;
  technical_description?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
  version?: InputMaybe<Order_By>;
};

/** primary key columns input for table: products */
export type Products_Pk_Columns_Input = {
  id: Scalars['uuid']['input'];
};

/** prepend existing jsonb value of filtered columns with new jsonb value */
export type Products_Prepend_Input = {
  inputs?: InputMaybe<Scalars['jsonb']['input']>;
  outputs?: InputMaybe<Scalars['jsonb']['input']>;
};

/** select columns of table "products" */
export enum Products_Select_Column {
  /** column name */
  Author = 'author',
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  Description = 'description',
  /** column name */
  Greeting = 'greeting',
  /** column name */
  Id = 'id',
  /** column name */
  ImageUrl = 'image_url',
  /** column name */
  Inputs = 'inputs',
  /** column name */
  LongDescription = 'long_description',
  /** column name */
  Name = 'name',
  /** column name */
  Nsfw = 'nsfw',
  /** column name */
  Outputs = 'outputs',
  /** column name */
  Slug = 'slug',
  /** column name */
  SourceUrl = 'source_url',
  /** column name */
  TechnicalDescription = 'technical_description',
  /** column name */
  UpdatedAt = 'updated_at',
  /** column name */
  Version = 'version'
}

/** select "products_aggregate_bool_exp_bool_and_arguments_columns" columns of table "products" */
export enum Products_Select_Column_Products_Aggregate_Bool_Exp_Bool_And_Arguments_Columns {
  /** column name */
  Nsfw = 'nsfw'
}

/** select "products_aggregate_bool_exp_bool_or_arguments_columns" columns of table "products" */
export enum Products_Select_Column_Products_Aggregate_Bool_Exp_Bool_Or_Arguments_Columns {
  /** column name */
  Nsfw = 'nsfw'
}

/** input type for updating data in table "products" */
export type Products_Set_Input = {
  author?: InputMaybe<Scalars['String']['input']>;
  created_at?: InputMaybe<Scalars['timestamptz']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  greeting?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['uuid']['input']>;
  image_url?: InputMaybe<Scalars['String']['input']>;
  inputs?: InputMaybe<Scalars['jsonb']['input']>;
  long_description?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  nsfw?: InputMaybe<Scalars['Boolean']['input']>;
  outputs?: InputMaybe<Scalars['jsonb']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
  source_url?: InputMaybe<Scalars['String']['input']>;
  technical_description?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamptz']['input']>;
  version?: InputMaybe<Scalars['String']['input']>;
};

/** Streaming cursor of the table "products" */
export type Products_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Products_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Products_Stream_Cursor_Value_Input = {
  author?: InputMaybe<Scalars['String']['input']>;
  created_at?: InputMaybe<Scalars['timestamptz']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  greeting?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['uuid']['input']>;
  image_url?: InputMaybe<Scalars['String']['input']>;
  inputs?: InputMaybe<Scalars['jsonb']['input']>;
  long_description?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  nsfw?: InputMaybe<Scalars['Boolean']['input']>;
  outputs?: InputMaybe<Scalars['jsonb']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
  source_url?: InputMaybe<Scalars['String']['input']>;
  technical_description?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamptz']['input']>;
  version?: InputMaybe<Scalars['String']['input']>;
};

/** update columns of table "products" */
export enum Products_Update_Column {
  /** column name */
  Author = 'author',
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  Description = 'description',
  /** column name */
  Greeting = 'greeting',
  /** column name */
  Id = 'id',
  /** column name */
  ImageUrl = 'image_url',
  /** column name */
  Inputs = 'inputs',
  /** column name */
  LongDescription = 'long_description',
  /** column name */
  Name = 'name',
  /** column name */
  Nsfw = 'nsfw',
  /** column name */
  Outputs = 'outputs',
  /** column name */
  Slug = 'slug',
  /** column name */
  SourceUrl = 'source_url',
  /** column name */
  TechnicalDescription = 'technical_description',
  /** column name */
  UpdatedAt = 'updated_at',
  /** column name */
  Version = 'version'
}

export type Products_Updates = {
  /** append existing jsonb value of filtered columns with new jsonb value */
  _append?: InputMaybe<Products_Append_Input>;
  /** delete the field or element with specified path (for JSON arrays, negative integers count from the end) */
  _delete_at_path?: InputMaybe<Products_Delete_At_Path_Input>;
  /** delete the array element with specified index (negative integers count from the end). throws an error if top level container is not an array */
  _delete_elem?: InputMaybe<Products_Delete_Elem_Input>;
  /** delete key/value pair or string element. key/value pairs are matched based on their key value */
  _delete_key?: InputMaybe<Products_Delete_Key_Input>;
  /** prepend existing jsonb value of filtered columns with new jsonb value */
  _prepend?: InputMaybe<Products_Prepend_Input>;
  /** sets the columns of the filtered rows to the given values */
  _set?: InputMaybe<Products_Set_Input>;
  /** filter the rows which have to be updated */
  where: Products_Bool_Exp;
};

/** columns and relationships of "prompts" */
export type Prompts = {
  __typename?: 'prompts';
  content?: Maybe<Scalars['String']['output']>;
  created_at: Scalars['timestamptz']['output'];
  id: Scalars['uuid']['output'];
  image_url?: Maybe<Scalars['String']['output']>;
  /** An array relationship */
  prompt_products: Array<Product_Prompts>;
  /** An aggregate relationship */
  prompt_products_aggregate: Product_Prompts_Aggregate;
  slug: Scalars['String']['output'];
  updated_at: Scalars['timestamptz']['output'];
};


/** columns and relationships of "prompts" */
export type PromptsPrompt_ProductsArgs = {
  distinct_on?: InputMaybe<Array<Product_Prompts_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Product_Prompts_Order_By>>;
  where?: InputMaybe<Product_Prompts_Bool_Exp>;
};


/** columns and relationships of "prompts" */
export type PromptsPrompt_Products_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Product_Prompts_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Product_Prompts_Order_By>>;
  where?: InputMaybe<Product_Prompts_Bool_Exp>;
};

/** aggregated selection of "prompts" */
export type Prompts_Aggregate = {
  __typename?: 'prompts_aggregate';
  aggregate?: Maybe<Prompts_Aggregate_Fields>;
  nodes: Array<Prompts>;
};

export type Prompts_Aggregate_Bool_Exp = {
  count?: InputMaybe<Prompts_Aggregate_Bool_Exp_Count>;
};

export type Prompts_Aggregate_Bool_Exp_Count = {
  arguments?: InputMaybe<Array<Prompts_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
  filter?: InputMaybe<Prompts_Bool_Exp>;
  predicate: Int_Comparison_Exp;
};

/** aggregate fields of "prompts" */
export type Prompts_Aggregate_Fields = {
  __typename?: 'prompts_aggregate_fields';
  count: Scalars['Int']['output'];
  max?: Maybe<Prompts_Max_Fields>;
  min?: Maybe<Prompts_Min_Fields>;
};


/** aggregate fields of "prompts" */
export type Prompts_Aggregate_FieldsCountArgs = {
  columns?: InputMaybe<Array<Prompts_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
};

/** order by aggregate values of table "prompts" */
export type Prompts_Aggregate_Order_By = {
  count?: InputMaybe<Order_By>;
  max?: InputMaybe<Prompts_Max_Order_By>;
  min?: InputMaybe<Prompts_Min_Order_By>;
};

/** input type for inserting array relation for remote table "prompts" */
export type Prompts_Arr_Rel_Insert_Input = {
  data: Array<Prompts_Insert_Input>;
  /** upsert condition */
  on_conflict?: InputMaybe<Prompts_On_Conflict>;
};

/** Boolean expression to filter rows from the table "prompts". All fields are combined with a logical 'AND'. */
export type Prompts_Bool_Exp = {
  _and?: InputMaybe<Array<Prompts_Bool_Exp>>;
  _not?: InputMaybe<Prompts_Bool_Exp>;
  _or?: InputMaybe<Array<Prompts_Bool_Exp>>;
  content?: InputMaybe<String_Comparison_Exp>;
  created_at?: InputMaybe<Timestamptz_Comparison_Exp>;
  id?: InputMaybe<Uuid_Comparison_Exp>;
  image_url?: InputMaybe<String_Comparison_Exp>;
  prompt_products?: InputMaybe<Product_Prompts_Bool_Exp>;
  prompt_products_aggregate?: InputMaybe<Product_Prompts_Aggregate_Bool_Exp>;
  slug?: InputMaybe<String_Comparison_Exp>;
  updated_at?: InputMaybe<Timestamptz_Comparison_Exp>;
};

/** unique or primary key constraints on table "prompts" */
export enum Prompts_Constraint {
  /** unique or primary key constraint on columns "id" */
  PromptsPkey = 'prompts_pkey',
  /** unique or primary key constraint on columns "slug" */
  PromptsSlugKey = 'prompts_slug_key'
}

/** input type for inserting data into table "prompts" */
export type Prompts_Insert_Input = {
  content?: InputMaybe<Scalars['String']['input']>;
  created_at?: InputMaybe<Scalars['timestamptz']['input']>;
  id?: InputMaybe<Scalars['uuid']['input']>;
  image_url?: InputMaybe<Scalars['String']['input']>;
  prompt_products?: InputMaybe<Product_Prompts_Arr_Rel_Insert_Input>;
  slug?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamptz']['input']>;
};

/** aggregate max on columns */
export type Prompts_Max_Fields = {
  __typename?: 'prompts_max_fields';
  content?: Maybe<Scalars['String']['output']>;
  created_at?: Maybe<Scalars['timestamptz']['output']>;
  id?: Maybe<Scalars['uuid']['output']>;
  image_url?: Maybe<Scalars['String']['output']>;
  slug?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamptz']['output']>;
};

/** order by max() on columns of table "prompts" */
export type Prompts_Max_Order_By = {
  content?: InputMaybe<Order_By>;
  created_at?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  image_url?: InputMaybe<Order_By>;
  slug?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** aggregate min on columns */
export type Prompts_Min_Fields = {
  __typename?: 'prompts_min_fields';
  content?: Maybe<Scalars['String']['output']>;
  created_at?: Maybe<Scalars['timestamptz']['output']>;
  id?: Maybe<Scalars['uuid']['output']>;
  image_url?: Maybe<Scalars['String']['output']>;
  slug?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamptz']['output']>;
};

/** order by min() on columns of table "prompts" */
export type Prompts_Min_Order_By = {
  content?: InputMaybe<Order_By>;
  created_at?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  image_url?: InputMaybe<Order_By>;
  slug?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** response of any mutation on the table "prompts" */
export type Prompts_Mutation_Response = {
  __typename?: 'prompts_mutation_response';
  /** number of rows affected by the mutation */
  affected_rows: Scalars['Int']['output'];
  /** data from the rows affected by the mutation */
  returning: Array<Prompts>;
};

/** on_conflict condition type for table "prompts" */
export type Prompts_On_Conflict = {
  constraint: Prompts_Constraint;
  update_columns?: Array<Prompts_Update_Column>;
  where?: InputMaybe<Prompts_Bool_Exp>;
};

/** Ordering options when selecting data from "prompts". */
export type Prompts_Order_By = {
  content?: InputMaybe<Order_By>;
  created_at?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  image_url?: InputMaybe<Order_By>;
  prompt_products_aggregate?: InputMaybe<Product_Prompts_Aggregate_Order_By>;
  slug?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** primary key columns input for table: prompts */
export type Prompts_Pk_Columns_Input = {
  id: Scalars['uuid']['input'];
};

/** select columns of table "prompts" */
export enum Prompts_Select_Column {
  /** column name */
  Content = 'content',
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  Id = 'id',
  /** column name */
  ImageUrl = 'image_url',
  /** column name */
  Slug = 'slug',
  /** column name */
  UpdatedAt = 'updated_at'
}

/** input type for updating data in table "prompts" */
export type Prompts_Set_Input = {
  content?: InputMaybe<Scalars['String']['input']>;
  created_at?: InputMaybe<Scalars['timestamptz']['input']>;
  id?: InputMaybe<Scalars['uuid']['input']>;
  image_url?: InputMaybe<Scalars['String']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamptz']['input']>;
};

/** Streaming cursor of the table "prompts" */
export type Prompts_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Prompts_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Prompts_Stream_Cursor_Value_Input = {
  content?: InputMaybe<Scalars['String']['input']>;
  created_at?: InputMaybe<Scalars['timestamptz']['input']>;
  id?: InputMaybe<Scalars['uuid']['input']>;
  image_url?: InputMaybe<Scalars['String']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamptz']['input']>;
};

/** update columns of table "prompts" */
export enum Prompts_Update_Column {
  /** column name */
  Content = 'content',
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  Id = 'id',
  /** column name */
  ImageUrl = 'image_url',
  /** column name */
  Slug = 'slug',
  /** column name */
  UpdatedAt = 'updated_at'
}

export type Prompts_Updates = {
  /** sets the columns of the filtered rows to the given values */
  _set?: InputMaybe<Prompts_Set_Input>;
  /** filter the rows which have to be updated */
  where: Prompts_Bool_Exp;
};

export type Query_Root = {
  __typename?: 'query_root';
  /** An array relationship */
  collection_products: Array<Collection_Products>;
  /** An aggregate relationship */
  collection_products_aggregate: Collection_Products_Aggregate;
  /** fetch data from the table: "collection_products" using primary key columns */
  collection_products_by_pk?: Maybe<Collection_Products>;
  /** An array relationship */
  collections: Array<Collections>;
  /** An aggregate relationship */
  collections_aggregate: Collections_Aggregate;
  /** fetch data from the table: "collections" using primary key columns */
  collections_by_pk?: Maybe<Collections>;
  /** fetch data from the table: "conversations" */
  conversations: Array<Conversations>;
  /** fetch aggregated fields from the table: "conversations" */
  conversations_aggregate: Conversations_Aggregate;
  /** fetch data from the table: "conversations" using primary key columns */
  conversations_by_pk?: Maybe<Conversations>;
  /** An array relationship */
  message_medias: Array<Message_Medias>;
  /** An aggregate relationship */
  message_medias_aggregate: Message_Medias_Aggregate;
  /** fetch data from the table: "message_medias" using primary key columns */
  message_medias_by_pk?: Maybe<Message_Medias>;
  /** fetch data from the table: "messages" */
  messages: Array<Messages>;
  /** fetch aggregated fields from the table: "messages" */
  messages_aggregate: Messages_Aggregate;
  /** fetch data from the table: "messages" using primary key columns */
  messages_by_pk?: Maybe<Messages>;
  /** An array relationship */
  product_prompts: Array<Product_Prompts>;
  /** An aggregate relationship */
  product_prompts_aggregate: Product_Prompts_Aggregate;
  /** fetch data from the table: "product_prompts" using primary key columns */
  product_prompts_by_pk?: Maybe<Product_Prompts>;
  /** An array relationship */
  products: Array<Products>;
  /** An aggregate relationship */
  products_aggregate: Products_Aggregate;
  /** fetch data from the table: "products" using primary key columns */
  products_by_pk?: Maybe<Products>;
  /** An array relationship */
  prompts: Array<Prompts>;
  /** An aggregate relationship */
  prompts_aggregate: Prompts_Aggregate;
  /** fetch data from the table: "prompts" using primary key columns */
  prompts_by_pk?: Maybe<Prompts>;
};


export type Query_RootCollection_ProductsArgs = {
  distinct_on?: InputMaybe<Array<Collection_Products_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Collection_Products_Order_By>>;
  where?: InputMaybe<Collection_Products_Bool_Exp>;
};


export type Query_RootCollection_Products_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Collection_Products_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Collection_Products_Order_By>>;
  where?: InputMaybe<Collection_Products_Bool_Exp>;
};


export type Query_RootCollection_Products_By_PkArgs = {
  id: Scalars['uuid']['input'];
};


export type Query_RootCollectionsArgs = {
  distinct_on?: InputMaybe<Array<Collections_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Collections_Order_By>>;
  where?: InputMaybe<Collections_Bool_Exp>;
};


export type Query_RootCollections_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Collections_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Collections_Order_By>>;
  where?: InputMaybe<Collections_Bool_Exp>;
};


export type Query_RootCollections_By_PkArgs = {
  id: Scalars['uuid']['input'];
};


export type Query_RootConversationsArgs = {
  distinct_on?: InputMaybe<Array<Conversations_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Conversations_Order_By>>;
  where?: InputMaybe<Conversations_Bool_Exp>;
};


export type Query_RootConversations_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Conversations_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Conversations_Order_By>>;
  where?: InputMaybe<Conversations_Bool_Exp>;
};


export type Query_RootConversations_By_PkArgs = {
  id: Scalars['uuid']['input'];
};


export type Query_RootMessage_MediasArgs = {
  distinct_on?: InputMaybe<Array<Message_Medias_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Message_Medias_Order_By>>;
  where?: InputMaybe<Message_Medias_Bool_Exp>;
};


export type Query_RootMessage_Medias_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Message_Medias_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Message_Medias_Order_By>>;
  where?: InputMaybe<Message_Medias_Bool_Exp>;
};


export type Query_RootMessage_Medias_By_PkArgs = {
  id: Scalars['uuid']['input'];
};


export type Query_RootMessagesArgs = {
  distinct_on?: InputMaybe<Array<Messages_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Messages_Order_By>>;
  where?: InputMaybe<Messages_Bool_Exp>;
};


export type Query_RootMessages_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Messages_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Messages_Order_By>>;
  where?: InputMaybe<Messages_Bool_Exp>;
};


export type Query_RootMessages_By_PkArgs = {
  id: Scalars['uuid']['input'];
};


export type Query_RootProduct_PromptsArgs = {
  distinct_on?: InputMaybe<Array<Product_Prompts_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Product_Prompts_Order_By>>;
  where?: InputMaybe<Product_Prompts_Bool_Exp>;
};


export type Query_RootProduct_Prompts_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Product_Prompts_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Product_Prompts_Order_By>>;
  where?: InputMaybe<Product_Prompts_Bool_Exp>;
};


export type Query_RootProduct_Prompts_By_PkArgs = {
  id: Scalars['uuid']['input'];
};


export type Query_RootProductsArgs = {
  distinct_on?: InputMaybe<Array<Products_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Products_Order_By>>;
  where?: InputMaybe<Products_Bool_Exp>;
};


export type Query_RootProducts_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Products_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Products_Order_By>>;
  where?: InputMaybe<Products_Bool_Exp>;
};


export type Query_RootProducts_By_PkArgs = {
  id: Scalars['uuid']['input'];
};


export type Query_RootPromptsArgs = {
  distinct_on?: InputMaybe<Array<Prompts_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Prompts_Order_By>>;
  where?: InputMaybe<Prompts_Bool_Exp>;
};


export type Query_RootPrompts_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Prompts_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Prompts_Order_By>>;
  where?: InputMaybe<Prompts_Bool_Exp>;
};


export type Query_RootPrompts_By_PkArgs = {
  id: Scalars['uuid']['input'];
};

export type Subscription_Root = {
  __typename?: 'subscription_root';
  /** An array relationship */
  collection_products: Array<Collection_Products>;
  /** An aggregate relationship */
  collection_products_aggregate: Collection_Products_Aggregate;
  /** fetch data from the table: "collection_products" using primary key columns */
  collection_products_by_pk?: Maybe<Collection_Products>;
  /** fetch data from the table in a streaming manner: "collection_products" */
  collection_products_stream: Array<Collection_Products>;
  /** An array relationship */
  collections: Array<Collections>;
  /** An aggregate relationship */
  collections_aggregate: Collections_Aggregate;
  /** fetch data from the table: "collections" using primary key columns */
  collections_by_pk?: Maybe<Collections>;
  /** fetch data from the table in a streaming manner: "collections" */
  collections_stream: Array<Collections>;
  /** fetch data from the table: "conversations" */
  conversations: Array<Conversations>;
  /** fetch aggregated fields from the table: "conversations" */
  conversations_aggregate: Conversations_Aggregate;
  /** fetch data from the table: "conversations" using primary key columns */
  conversations_by_pk?: Maybe<Conversations>;
  /** fetch data from the table in a streaming manner: "conversations" */
  conversations_stream: Array<Conversations>;
  /** An array relationship */
  message_medias: Array<Message_Medias>;
  /** An aggregate relationship */
  message_medias_aggregate: Message_Medias_Aggregate;
  /** fetch data from the table: "message_medias" using primary key columns */
  message_medias_by_pk?: Maybe<Message_Medias>;
  /** fetch data from the table in a streaming manner: "message_medias" */
  message_medias_stream: Array<Message_Medias>;
  /** fetch data from the table: "messages" */
  messages: Array<Messages>;
  /** fetch aggregated fields from the table: "messages" */
  messages_aggregate: Messages_Aggregate;
  /** fetch data from the table: "messages" using primary key columns */
  messages_by_pk?: Maybe<Messages>;
  /** fetch data from the table in a streaming manner: "messages" */
  messages_stream: Array<Messages>;
  /** An array relationship */
  product_prompts: Array<Product_Prompts>;
  /** An aggregate relationship */
  product_prompts_aggregate: Product_Prompts_Aggregate;
  /** fetch data from the table: "product_prompts" using primary key columns */
  product_prompts_by_pk?: Maybe<Product_Prompts>;
  /** fetch data from the table in a streaming manner: "product_prompts" */
  product_prompts_stream: Array<Product_Prompts>;
  /** An array relationship */
  products: Array<Products>;
  /** An aggregate relationship */
  products_aggregate: Products_Aggregate;
  /** fetch data from the table: "products" using primary key columns */
  products_by_pk?: Maybe<Products>;
  /** fetch data from the table in a streaming manner: "products" */
  products_stream: Array<Products>;
  /** An array relationship */
  prompts: Array<Prompts>;
  /** An aggregate relationship */
  prompts_aggregate: Prompts_Aggregate;
  /** fetch data from the table: "prompts" using primary key columns */
  prompts_by_pk?: Maybe<Prompts>;
  /** fetch data from the table in a streaming manner: "prompts" */
  prompts_stream: Array<Prompts>;
};


export type Subscription_RootCollection_ProductsArgs = {
  distinct_on?: InputMaybe<Array<Collection_Products_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Collection_Products_Order_By>>;
  where?: InputMaybe<Collection_Products_Bool_Exp>;
};


export type Subscription_RootCollection_Products_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Collection_Products_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Collection_Products_Order_By>>;
  where?: InputMaybe<Collection_Products_Bool_Exp>;
};


export type Subscription_RootCollection_Products_By_PkArgs = {
  id: Scalars['uuid']['input'];
};


export type Subscription_RootCollection_Products_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Collection_Products_Stream_Cursor_Input>>;
  where?: InputMaybe<Collection_Products_Bool_Exp>;
};


export type Subscription_RootCollectionsArgs = {
  distinct_on?: InputMaybe<Array<Collections_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Collections_Order_By>>;
  where?: InputMaybe<Collections_Bool_Exp>;
};


export type Subscription_RootCollections_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Collections_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Collections_Order_By>>;
  where?: InputMaybe<Collections_Bool_Exp>;
};


export type Subscription_RootCollections_By_PkArgs = {
  id: Scalars['uuid']['input'];
};


export type Subscription_RootCollections_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Collections_Stream_Cursor_Input>>;
  where?: InputMaybe<Collections_Bool_Exp>;
};


export type Subscription_RootConversationsArgs = {
  distinct_on?: InputMaybe<Array<Conversations_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Conversations_Order_By>>;
  where?: InputMaybe<Conversations_Bool_Exp>;
};


export type Subscription_RootConversations_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Conversations_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Conversations_Order_By>>;
  where?: InputMaybe<Conversations_Bool_Exp>;
};


export type Subscription_RootConversations_By_PkArgs = {
  id: Scalars['uuid']['input'];
};


export type Subscription_RootConversations_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Conversations_Stream_Cursor_Input>>;
  where?: InputMaybe<Conversations_Bool_Exp>;
};


export type Subscription_RootMessage_MediasArgs = {
  distinct_on?: InputMaybe<Array<Message_Medias_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Message_Medias_Order_By>>;
  where?: InputMaybe<Message_Medias_Bool_Exp>;
};


export type Subscription_RootMessage_Medias_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Message_Medias_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Message_Medias_Order_By>>;
  where?: InputMaybe<Message_Medias_Bool_Exp>;
};


export type Subscription_RootMessage_Medias_By_PkArgs = {
  id: Scalars['uuid']['input'];
};


export type Subscription_RootMessage_Medias_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Message_Medias_Stream_Cursor_Input>>;
  where?: InputMaybe<Message_Medias_Bool_Exp>;
};


export type Subscription_RootMessagesArgs = {
  distinct_on?: InputMaybe<Array<Messages_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Messages_Order_By>>;
  where?: InputMaybe<Messages_Bool_Exp>;
};


export type Subscription_RootMessages_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Messages_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Messages_Order_By>>;
  where?: InputMaybe<Messages_Bool_Exp>;
};


export type Subscription_RootMessages_By_PkArgs = {
  id: Scalars['uuid']['input'];
};


export type Subscription_RootMessages_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Messages_Stream_Cursor_Input>>;
  where?: InputMaybe<Messages_Bool_Exp>;
};


export type Subscription_RootProduct_PromptsArgs = {
  distinct_on?: InputMaybe<Array<Product_Prompts_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Product_Prompts_Order_By>>;
  where?: InputMaybe<Product_Prompts_Bool_Exp>;
};


export type Subscription_RootProduct_Prompts_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Product_Prompts_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Product_Prompts_Order_By>>;
  where?: InputMaybe<Product_Prompts_Bool_Exp>;
};


export type Subscription_RootProduct_Prompts_By_PkArgs = {
  id: Scalars['uuid']['input'];
};


export type Subscription_RootProduct_Prompts_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Product_Prompts_Stream_Cursor_Input>>;
  where?: InputMaybe<Product_Prompts_Bool_Exp>;
};


export type Subscription_RootProductsArgs = {
  distinct_on?: InputMaybe<Array<Products_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Products_Order_By>>;
  where?: InputMaybe<Products_Bool_Exp>;
};


export type Subscription_RootProducts_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Products_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Products_Order_By>>;
  where?: InputMaybe<Products_Bool_Exp>;
};


export type Subscription_RootProducts_By_PkArgs = {
  id: Scalars['uuid']['input'];
};


export type Subscription_RootProducts_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Products_Stream_Cursor_Input>>;
  where?: InputMaybe<Products_Bool_Exp>;
};


export type Subscription_RootPromptsArgs = {
  distinct_on?: InputMaybe<Array<Prompts_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Prompts_Order_By>>;
  where?: InputMaybe<Prompts_Bool_Exp>;
};


export type Subscription_RootPrompts_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Prompts_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Prompts_Order_By>>;
  where?: InputMaybe<Prompts_Bool_Exp>;
};


export type Subscription_RootPrompts_By_PkArgs = {
  id: Scalars['uuid']['input'];
};


export type Subscription_RootPrompts_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Prompts_Stream_Cursor_Input>>;
  where?: InputMaybe<Prompts_Bool_Exp>;
};

/** Boolean expression to compare columns of type "timestamptz". All fields are combined with logical 'AND'. */
export type Timestamptz_Comparison_Exp = {
  _eq?: InputMaybe<Scalars['timestamptz']['input']>;
  _gt?: InputMaybe<Scalars['timestamptz']['input']>;
  _gte?: InputMaybe<Scalars['timestamptz']['input']>;
  _in?: InputMaybe<Array<Scalars['timestamptz']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['timestamptz']['input']>;
  _lte?: InputMaybe<Scalars['timestamptz']['input']>;
  _neq?: InputMaybe<Scalars['timestamptz']['input']>;
  _nin?: InputMaybe<Array<Scalars['timestamptz']['input']>>;
};

/** Boolean expression to compare columns of type "uuid". All fields are combined with logical 'AND'. */
export type Uuid_Comparison_Exp = {
  _eq?: InputMaybe<Scalars['uuid']['input']>;
  _gt?: InputMaybe<Scalars['uuid']['input']>;
  _gte?: InputMaybe<Scalars['uuid']['input']>;
  _in?: InputMaybe<Array<Scalars['uuid']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['uuid']['input']>;
  _lte?: InputMaybe<Scalars['uuid']['input']>;
  _neq?: InputMaybe<Scalars['uuid']['input']>;
  _nin?: InputMaybe<Array<Scalars['uuid']['input']>>;
};

export type CollectionDetailFragment = { __typename?: 'collections', slug: string, name: string };

export type ConversationDetailFragment = { __typename?: 'conversations', id: any, product_id: any, user_id: string, last_image_url?: string | null, last_text_message?: string | null, created_at: any, updated_at: any, conversation_product?: { __typename?: 'products', id: any, name: string, slug: string, description?: string | null, long_description?: string | null, technical_description?: string | null, image_url?: string | null, author?: string | null, greeting?: string | null, source_url?: string | null, version?: string | null, inputs?: any | null, outputs?: any | null, nsfw: boolean, created_at: any, updated_at: any } | null };

export type MessageMediaFragment = { __typename?: 'message_medias', id: any, message_id: any, media_url?: string | null, mime_type?: string | null, updated_at: any };

export type MessageDetailFragment = { __typename?: 'messages', id: any, conversation_id: any, sender: string, sender_name?: string | null, sender_avatar_url?: string | null, content?: string | null, message_type?: string | null, message_sender_type?: string | null, created_at: any, updated_at: any, status?: string | null, message_medias: Array<{ __typename?: 'message_medias', id: any, message_id: any, media_url?: string | null, mime_type?: string | null, updated_at: any }> };

export type ProductDetailFragment = { __typename?: 'products', id: any, name: string, slug: string, description?: string | null, long_description?: string | null, technical_description?: string | null, image_url?: string | null, author?: string | null, greeting?: string | null, source_url?: string | null, version?: string | null, inputs?: any | null, outputs?: any | null, nsfw: boolean, created_at: any, updated_at: any };

export type PromptDetailFragment = { __typename?: 'prompts', slug: string, content?: string | null, image_url?: string | null };

export type CreateConversationMutationVariables = Exact<{
  data: Conversations_Insert_Input;
}>;


export type CreateConversationMutation = { __typename?: 'mutation_root', insert_conversations_one?: { __typename?: 'conversations', id: any, product_id: any, user_id: string, last_image_url?: string | null, last_text_message?: string | null, created_at: any, updated_at: any, conversation_product?: { __typename?: 'products', id: any, name: string, slug: string, description?: string | null, long_description?: string | null, technical_description?: string | null, image_url?: string | null, author?: string | null, greeting?: string | null, source_url?: string | null, version?: string | null, inputs?: any | null, outputs?: any | null, nsfw: boolean, created_at: any, updated_at: any } | null } | null };

export type CreateMessageMutationVariables = Exact<{
  data: Messages_Insert_Input;
}>;


export type CreateMessageMutation = { __typename?: 'mutation_root', insert_messages_one?: { __typename?: 'messages', id: any, conversation_id: any, sender: string, sender_name?: string | null, sender_avatar_url?: string | null, content?: string | null, message_type?: string | null, message_sender_type?: string | null, created_at: any, updated_at: any, status?: string | null, message_medias: Array<{ __typename?: 'message_medias', id: any, message_id: any, media_url?: string | null, mime_type?: string | null, updated_at: any }> } | null };

export type DeleteConversationMutationVariables = Exact<{
  id: Scalars['uuid']['input'];
}>;


export type DeleteConversationMutation = { __typename?: 'mutation_root', delete_conversations_by_pk?: { __typename?: 'conversations', id: any } | null };

export type GenerateImageMutationVariables = Exact<{
  model?: InputMaybe<Scalars['String']['input']>;
  neg_prompt?: InputMaybe<Scalars['String']['input']>;
  prompt?: InputMaybe<Scalars['String']['input']>;
  seed?: InputMaybe<Scalars['Int']['input']>;
  steps?: InputMaybe<Scalars['Int']['input']>;
  width?: InputMaybe<Scalars['Int']['input']>;
  height?: InputMaybe<Scalars['Int']['input']>;
}>;


export type GenerateImageMutation = { __typename?: 'mutation_root', imageGeneration?: { __typename?: 'ImageGenerationOutput', url: string } | null };

export type UpdateConversationMutationVariables = Exact<{
  id: Scalars['uuid']['input'];
  lastMessageText?: InputMaybe<Scalars['String']['input']>;
  lastMessageUrl?: InputMaybe<Scalars['String']['input']>;
}>;


export type UpdateConversationMutation = { __typename?: 'mutation_root', update_conversations_by_pk?: { __typename?: 'conversations', id: any, product_id: any, user_id: string, last_image_url?: string | null, last_text_message?: string | null, created_at: any, updated_at: any, conversation_product?: { __typename?: 'products', id: any, name: string, slug: string, description?: string | null, long_description?: string | null, technical_description?: string | null, image_url?: string | null, author?: string | null, greeting?: string | null, source_url?: string | null, version?: string | null, inputs?: any | null, outputs?: any | null, nsfw: boolean, created_at: any, updated_at: any } | null } | null };

export type UpdateMessageMutationVariables = Exact<{
  id?: InputMaybe<Scalars['uuid']['input']>;
  data: Messages_Set_Input;
}>;


export type UpdateMessageMutation = { __typename?: 'mutation_root', update_messages_by_pk?: { __typename?: 'messages', id: any, conversation_id: any, sender: string, sender_name?: string | null, sender_avatar_url?: string | null, content?: string | null, message_type?: string | null, message_sender_type?: string | null, created_at: any, updated_at: any, status?: string | null, message_medias: Array<{ __typename?: 'message_medias', id: any, message_id: any, media_url?: string | null, mime_type?: string | null, updated_at: any }> } | null };

export type GetCollectionsQueryVariables = Exact<{ [key: string]: never; }>;


export type GetCollectionsQuery = { __typename?: 'query_root', collections: Array<{ __typename?: 'collections', slug: string, name: string, collection_products: Array<{ __typename?: 'collection_products', products: Array<{ __typename?: 'products', id: any, name: string, slug: string, description?: string | null, long_description?: string | null, technical_description?: string | null, image_url?: string | null, author?: string | null, greeting?: string | null, source_url?: string | null, version?: string | null, inputs?: any | null, outputs?: any | null, nsfw: boolean, created_at: any, updated_at: any, product_prompts: Array<{ __typename?: 'product_prompts', prompts: Array<{ __typename?: 'prompts', slug: string, content?: string | null, image_url?: string | null }> }> }> }> }> };

export type GetConversationMessagesQueryVariables = Exact<{
  conversation_id?: InputMaybe<Scalars['uuid']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
}>;


export type GetConversationMessagesQuery = { __typename?: 'query_root', messages: Array<{ __typename?: 'messages', id: any, conversation_id: any, sender: string, sender_name?: string | null, sender_avatar_url?: string | null, content?: string | null, message_type?: string | null, message_sender_type?: string | null, created_at: any, updated_at: any, status?: string | null, message_medias: Array<{ __typename?: 'message_medias', id: any, message_id: any, media_url?: string | null, mime_type?: string | null, updated_at: any }> }> };

export type GetConversationsQueryVariables = Exact<{ [key: string]: never; }>;


export type GetConversationsQuery = { __typename?: 'query_root', conversations: Array<{ __typename?: 'conversations', id: any, product_id: any, user_id: string, last_image_url?: string | null, last_text_message?: string | null, created_at: any, updated_at: any, conversation_messages: Array<{ __typename?: 'messages', id: any, conversation_id: any, sender: string, sender_name?: string | null, sender_avatar_url?: string | null, content?: string | null, message_type?: string | null, message_sender_type?: string | null, created_at: any, updated_at: any, status?: string | null, message_medias: Array<{ __typename?: 'message_medias', id: any, message_id: any, media_url?: string | null, mime_type?: string | null, updated_at: any }> }>, conversation_product?: { __typename?: 'products', id: any, name: string, slug: string, description?: string | null, long_description?: string | null, technical_description?: string | null, image_url?: string | null, author?: string | null, greeting?: string | null, source_url?: string | null, version?: string | null, inputs?: any | null, outputs?: any | null, nsfw: boolean, created_at: any, updated_at: any } | null }> };

export type GetProductsByCollectionSlugQueryVariables = Exact<{
  slug?: InputMaybe<Scalars['String']['input']>;
}>;


export type GetProductsByCollectionSlugQuery = { __typename?: 'query_root', products: Array<{ __typename?: 'products', id: any, name: string, slug: string, description?: string | null, long_description?: string | null, technical_description?: string | null, image_url?: string | null, author?: string | null, greeting?: string | null, source_url?: string | null, version?: string | null, inputs?: any | null, outputs?: any | null, nsfw: boolean, created_at: any, updated_at: any, product_prompts: Array<{ __typename?: 'product_prompts', prompts: Array<{ __typename?: 'prompts', slug: string, content?: string | null, image_url?: string | null }> }>, product_collections: Array<{ __typename?: 'collection_products', collections: Array<{ __typename?: 'collections', slug: string, name: string }> }> }> };

export type GetProductPromptsQueryVariables = Exact<{
  productSlug?: InputMaybe<Scalars['String']['input']>;
}>;


export type GetProductPromptsQuery = { __typename?: 'query_root', prompts: Array<{ __typename?: 'prompts', slug: string, content?: string | null, image_url?: string | null }> };

export type GetProductsQueryVariables = Exact<{ [key: string]: never; }>;


export type GetProductsQuery = { __typename?: 'query_root', products: Array<{ __typename?: 'products', id: any, name: string, slug: string, description?: string | null, long_description?: string | null, technical_description?: string | null, image_url?: string | null, author?: string | null, greeting?: string | null, source_url?: string | null, version?: string | null, inputs?: any | null, outputs?: any | null, nsfw: boolean, created_at: any, updated_at: any, product_prompts: Array<{ __typename?: 'product_prompts', prompts: Array<{ __typename?: 'prompts', slug: string, content?: string | null, image_url?: string | null }> }>, product_collections: Array<{ __typename?: 'collection_products', collections: Array<{ __typename?: 'collections', slug: string, name: string }> }> }> };

export type GetProductsInQueryVariables = Exact<{
  _in?: InputMaybe<Array<Scalars['String']['input']> | Scalars['String']['input']>;
}>;


export type GetProductsInQuery = { __typename?: 'query_root', products: Array<{ __typename?: 'products', id: any, name: string, slug: string, description?: string | null, long_description?: string | null, technical_description?: string | null, image_url?: string | null, author?: string | null, greeting?: string | null, source_url?: string | null, version?: string | null, inputs?: any | null, outputs?: any | null, nsfw: boolean, created_at: any, updated_at: any }> };

export type SubscribeMessageSubscriptionVariables = Exact<{
  id?: InputMaybe<Scalars['uuid']['input']>;
}>;


export type SubscribeMessageSubscription = { __typename?: 'subscription_root', messages_by_pk?: { __typename?: 'messages', id: any, content?: string | null, status?: string | null } | null };

export const CollectionDetailFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CollectionDetail"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"collections"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]} as unknown as DocumentNode<CollectionDetailFragment, unknown>;
export const ProductDetailFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProductDetail"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"products"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"long_description"}},{"kind":"Field","name":{"kind":"Name","value":"technical_description"}},{"kind":"Field","name":{"kind":"Name","value":"image_url"}},{"kind":"Field","name":{"kind":"Name","value":"author"}},{"kind":"Field","name":{"kind":"Name","value":"greeting"}},{"kind":"Field","name":{"kind":"Name","value":"source_url"}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"inputs"}},{"kind":"Field","name":{"kind":"Name","value":"outputs"}},{"kind":"Field","name":{"kind":"Name","value":"nsfw"}},{"kind":"Field","name":{"kind":"Name","value":"created_at"}},{"kind":"Field","name":{"kind":"Name","value":"updated_at"}}]}}]} as unknown as DocumentNode<ProductDetailFragment, unknown>;
export const ConversationDetailFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ConversationDetail"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"conversations"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"product_id"}},{"kind":"Field","name":{"kind":"Name","value":"user_id"}},{"kind":"Field","name":{"kind":"Name","value":"last_image_url"}},{"kind":"Field","name":{"kind":"Name","value":"last_text_message"}},{"kind":"Field","name":{"kind":"Name","value":"created_at"}},{"kind":"Field","name":{"kind":"Name","value":"updated_at"}},{"kind":"Field","name":{"kind":"Name","value":"conversation_product"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProductDetail"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProductDetail"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"products"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"long_description"}},{"kind":"Field","name":{"kind":"Name","value":"technical_description"}},{"kind":"Field","name":{"kind":"Name","value":"image_url"}},{"kind":"Field","name":{"kind":"Name","value":"author"}},{"kind":"Field","name":{"kind":"Name","value":"greeting"}},{"kind":"Field","name":{"kind":"Name","value":"source_url"}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"inputs"}},{"kind":"Field","name":{"kind":"Name","value":"outputs"}},{"kind":"Field","name":{"kind":"Name","value":"nsfw"}},{"kind":"Field","name":{"kind":"Name","value":"created_at"}},{"kind":"Field","name":{"kind":"Name","value":"updated_at"}}]}}]} as unknown as DocumentNode<ConversationDetailFragment, unknown>;
export const MessageMediaFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MessageMedia"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"message_medias"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"message_id"}},{"kind":"Field","name":{"kind":"Name","value":"media_url"}},{"kind":"Field","name":{"kind":"Name","value":"mime_type"}},{"kind":"Field","name":{"kind":"Name","value":"updated_at"}}]}}]} as unknown as DocumentNode<MessageMediaFragment, unknown>;
export const MessageDetailFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MessageDetail"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"messages"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"conversation_id"}},{"kind":"Field","name":{"kind":"Name","value":"sender"}},{"kind":"Field","name":{"kind":"Name","value":"sender_name"}},{"kind":"Field","name":{"kind":"Name","value":"sender_avatar_url"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"message_type"}},{"kind":"Field","name":{"kind":"Name","value":"message_sender_type"}},{"kind":"Field","name":{"kind":"Name","value":"created_at"}},{"kind":"Field","name":{"kind":"Name","value":"updated_at"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"message_medias"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MessageMedia"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MessageMedia"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"message_medias"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"message_id"}},{"kind":"Field","name":{"kind":"Name","value":"media_url"}},{"kind":"Field","name":{"kind":"Name","value":"mime_type"}},{"kind":"Field","name":{"kind":"Name","value":"updated_at"}}]}}]} as unknown as DocumentNode<MessageDetailFragment, unknown>;
export const PromptDetailFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"PromptDetail"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"prompts"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"image_url"}}]}}]} as unknown as DocumentNode<PromptDetailFragment, unknown>;
export const CreateConversationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"createConversation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"data"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"conversations_insert_input"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"insert_conversations_one"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"object"},"value":{"kind":"Variable","name":{"kind":"Name","value":"data"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ConversationDetail"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProductDetail"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"products"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"long_description"}},{"kind":"Field","name":{"kind":"Name","value":"technical_description"}},{"kind":"Field","name":{"kind":"Name","value":"image_url"}},{"kind":"Field","name":{"kind":"Name","value":"author"}},{"kind":"Field","name":{"kind":"Name","value":"greeting"}},{"kind":"Field","name":{"kind":"Name","value":"source_url"}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"inputs"}},{"kind":"Field","name":{"kind":"Name","value":"outputs"}},{"kind":"Field","name":{"kind":"Name","value":"nsfw"}},{"kind":"Field","name":{"kind":"Name","value":"created_at"}},{"kind":"Field","name":{"kind":"Name","value":"updated_at"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ConversationDetail"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"conversations"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"product_id"}},{"kind":"Field","name":{"kind":"Name","value":"user_id"}},{"kind":"Field","name":{"kind":"Name","value":"last_image_url"}},{"kind":"Field","name":{"kind":"Name","value":"last_text_message"}},{"kind":"Field","name":{"kind":"Name","value":"created_at"}},{"kind":"Field","name":{"kind":"Name","value":"updated_at"}},{"kind":"Field","name":{"kind":"Name","value":"conversation_product"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProductDetail"}}]}}]}}]} as unknown as DocumentNode<CreateConversationMutation, CreateConversationMutationVariables>;
export const CreateMessageDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"createMessage"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"data"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"messages_insert_input"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"insert_messages_one"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"object"},"value":{"kind":"Variable","name":{"kind":"Name","value":"data"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MessageDetail"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MessageMedia"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"message_medias"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"message_id"}},{"kind":"Field","name":{"kind":"Name","value":"media_url"}},{"kind":"Field","name":{"kind":"Name","value":"mime_type"}},{"kind":"Field","name":{"kind":"Name","value":"updated_at"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MessageDetail"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"messages"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"conversation_id"}},{"kind":"Field","name":{"kind":"Name","value":"sender"}},{"kind":"Field","name":{"kind":"Name","value":"sender_name"}},{"kind":"Field","name":{"kind":"Name","value":"sender_avatar_url"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"message_type"}},{"kind":"Field","name":{"kind":"Name","value":"message_sender_type"}},{"kind":"Field","name":{"kind":"Name","value":"created_at"}},{"kind":"Field","name":{"kind":"Name","value":"updated_at"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"message_medias"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MessageMedia"}}]}}]}}]} as unknown as DocumentNode<CreateMessageMutation, CreateMessageMutationVariables>;
export const DeleteConversationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"deleteConversation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"uuid"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"delete_conversations_by_pk"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteConversationMutation, DeleteConversationMutationVariables>;
export const GenerateImageDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"generateImage"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"model"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}},"defaultValue":{"kind":"StringValue","value":"","block":false}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"neg_prompt"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}},"defaultValue":{"kind":"StringValue","value":"","block":false}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"prompt"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}},"defaultValue":{"kind":"StringValue","value":"","block":false}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"seed"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}},"defaultValue":{"kind":"IntValue","value":"10"}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"steps"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}},"defaultValue":{"kind":"IntValue","value":"10"}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"width"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}},"defaultValue":{"kind":"IntValue","value":"512"}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"height"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}},"defaultValue":{"kind":"IntValue","value":"512"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"imageGeneration"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"model"},"value":{"kind":"Variable","name":{"kind":"Name","value":"model"}}},{"kind":"ObjectField","name":{"kind":"Name","value":"neg_prompt"},"value":{"kind":"Variable","name":{"kind":"Name","value":"neg_prompt"}}},{"kind":"ObjectField","name":{"kind":"Name","value":"prompt"},"value":{"kind":"Variable","name":{"kind":"Name","value":"prompt"}}},{"kind":"ObjectField","name":{"kind":"Name","value":"seed"},"value":{"kind":"Variable","name":{"kind":"Name","value":"seed"}}},{"kind":"ObjectField","name":{"kind":"Name","value":"steps"},"value":{"kind":"Variable","name":{"kind":"Name","value":"steps"}}},{"kind":"ObjectField","name":{"kind":"Name","value":"width"},"value":{"kind":"Variable","name":{"kind":"Name","value":"width"}}},{"kind":"ObjectField","name":{"kind":"Name","value":"height"},"value":{"kind":"Variable","name":{"kind":"Name","value":"height"}}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}}]} as unknown as DocumentNode<GenerateImageMutation, GenerateImageMutationVariables>;
export const UpdateConversationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"updateConversation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"uuid"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"lastMessageText"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"lastMessageUrl"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"update_conversations_by_pk"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"pk_columns"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}},{"kind":"Argument","name":{"kind":"Name","value":"_set"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"last_text_message"},"value":{"kind":"Variable","name":{"kind":"Name","value":"lastMessageText"}}},{"kind":"ObjectField","name":{"kind":"Name","value":"last_image_url"},"value":{"kind":"Variable","name":{"kind":"Name","value":"lastMessageUrl"}}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ConversationDetail"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProductDetail"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"products"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"long_description"}},{"kind":"Field","name":{"kind":"Name","value":"technical_description"}},{"kind":"Field","name":{"kind":"Name","value":"image_url"}},{"kind":"Field","name":{"kind":"Name","value":"author"}},{"kind":"Field","name":{"kind":"Name","value":"greeting"}},{"kind":"Field","name":{"kind":"Name","value":"source_url"}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"inputs"}},{"kind":"Field","name":{"kind":"Name","value":"outputs"}},{"kind":"Field","name":{"kind":"Name","value":"nsfw"}},{"kind":"Field","name":{"kind":"Name","value":"created_at"}},{"kind":"Field","name":{"kind":"Name","value":"updated_at"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ConversationDetail"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"conversations"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"product_id"}},{"kind":"Field","name":{"kind":"Name","value":"user_id"}},{"kind":"Field","name":{"kind":"Name","value":"last_image_url"}},{"kind":"Field","name":{"kind":"Name","value":"last_text_message"}},{"kind":"Field","name":{"kind":"Name","value":"created_at"}},{"kind":"Field","name":{"kind":"Name","value":"updated_at"}},{"kind":"Field","name":{"kind":"Name","value":"conversation_product"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProductDetail"}}]}}]}}]} as unknown as DocumentNode<UpdateConversationMutation, UpdateConversationMutationVariables>;
export const UpdateMessageDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"updateMessage"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"uuid"}},"defaultValue":{"kind":"StringValue","value":"","block":false}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"data"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"messages_set_input"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"update_messages_by_pk"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"pk_columns"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}},{"kind":"Argument","name":{"kind":"Name","value":"_set"},"value":{"kind":"Variable","name":{"kind":"Name","value":"data"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MessageDetail"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MessageMedia"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"message_medias"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"message_id"}},{"kind":"Field","name":{"kind":"Name","value":"media_url"}},{"kind":"Field","name":{"kind":"Name","value":"mime_type"}},{"kind":"Field","name":{"kind":"Name","value":"updated_at"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MessageDetail"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"messages"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"conversation_id"}},{"kind":"Field","name":{"kind":"Name","value":"sender"}},{"kind":"Field","name":{"kind":"Name","value":"sender_name"}},{"kind":"Field","name":{"kind":"Name","value":"sender_avatar_url"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"message_type"}},{"kind":"Field","name":{"kind":"Name","value":"message_sender_type"}},{"kind":"Field","name":{"kind":"Name","value":"created_at"}},{"kind":"Field","name":{"kind":"Name","value":"updated_at"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"message_medias"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MessageMedia"}}]}}]}}]} as unknown as DocumentNode<UpdateMessageMutation, UpdateMessageMutationVariables>;
export const GetCollectionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"getCollections"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"collections"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CollectionDetail"}},{"kind":"Field","name":{"kind":"Name","value":"collection_products"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"products"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProductDetail"}},{"kind":"Field","name":{"kind":"Name","value":"product_prompts"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"prompts"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"PromptDetail"}}]}}]}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CollectionDetail"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"collections"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProductDetail"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"products"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"long_description"}},{"kind":"Field","name":{"kind":"Name","value":"technical_description"}},{"kind":"Field","name":{"kind":"Name","value":"image_url"}},{"kind":"Field","name":{"kind":"Name","value":"author"}},{"kind":"Field","name":{"kind":"Name","value":"greeting"}},{"kind":"Field","name":{"kind":"Name","value":"source_url"}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"inputs"}},{"kind":"Field","name":{"kind":"Name","value":"outputs"}},{"kind":"Field","name":{"kind":"Name","value":"nsfw"}},{"kind":"Field","name":{"kind":"Name","value":"created_at"}},{"kind":"Field","name":{"kind":"Name","value":"updated_at"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"PromptDetail"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"prompts"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"image_url"}}]}}]} as unknown as DocumentNode<GetCollectionsQuery, GetCollectionsQueryVariables>;
export const GetConversationMessagesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"getConversationMessages"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"conversation_id"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"uuid"}},"defaultValue":{"kind":"StringValue","value":"","block":false}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}},"defaultValue":{"kind":"IntValue","value":"100"}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"offset"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}},"defaultValue":{"kind":"IntValue","value":"100"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"messages"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"offset"},"value":{"kind":"Variable","name":{"kind":"Name","value":"offset"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}},{"kind":"Argument","name":{"kind":"Name","value":"where"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"conversation_id"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"_eq"},"value":{"kind":"Variable","name":{"kind":"Name","value":"conversation_id"}}}]}}]}},{"kind":"Argument","name":{"kind":"Name","value":"order_by"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"created_at"},"value":{"kind":"EnumValue","value":"desc"}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MessageDetail"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MessageMedia"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"message_medias"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"message_id"}},{"kind":"Field","name":{"kind":"Name","value":"media_url"}},{"kind":"Field","name":{"kind":"Name","value":"mime_type"}},{"kind":"Field","name":{"kind":"Name","value":"updated_at"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MessageDetail"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"messages"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"conversation_id"}},{"kind":"Field","name":{"kind":"Name","value":"sender"}},{"kind":"Field","name":{"kind":"Name","value":"sender_name"}},{"kind":"Field","name":{"kind":"Name","value":"sender_avatar_url"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"message_type"}},{"kind":"Field","name":{"kind":"Name","value":"message_sender_type"}},{"kind":"Field","name":{"kind":"Name","value":"created_at"}},{"kind":"Field","name":{"kind":"Name","value":"updated_at"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"message_medias"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MessageMedia"}}]}}]}}]} as unknown as DocumentNode<GetConversationMessagesQuery, GetConversationMessagesQueryVariables>;
export const GetConversationsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"getConversations"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"conversations"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"order_by"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"updated_at"},"value":{"kind":"EnumValue","value":"desc"}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ConversationDetail"}},{"kind":"Field","name":{"kind":"Name","value":"conversation_messages"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MessageDetail"}},{"kind":"Field","name":{"kind":"Name","value":"message_medias"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MessageMedia"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProductDetail"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"products"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"long_description"}},{"kind":"Field","name":{"kind":"Name","value":"technical_description"}},{"kind":"Field","name":{"kind":"Name","value":"image_url"}},{"kind":"Field","name":{"kind":"Name","value":"author"}},{"kind":"Field","name":{"kind":"Name","value":"greeting"}},{"kind":"Field","name":{"kind":"Name","value":"source_url"}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"inputs"}},{"kind":"Field","name":{"kind":"Name","value":"outputs"}},{"kind":"Field","name":{"kind":"Name","value":"nsfw"}},{"kind":"Field","name":{"kind":"Name","value":"created_at"}},{"kind":"Field","name":{"kind":"Name","value":"updated_at"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MessageMedia"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"message_medias"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"message_id"}},{"kind":"Field","name":{"kind":"Name","value":"media_url"}},{"kind":"Field","name":{"kind":"Name","value":"mime_type"}},{"kind":"Field","name":{"kind":"Name","value":"updated_at"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ConversationDetail"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"conversations"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"product_id"}},{"kind":"Field","name":{"kind":"Name","value":"user_id"}},{"kind":"Field","name":{"kind":"Name","value":"last_image_url"}},{"kind":"Field","name":{"kind":"Name","value":"last_text_message"}},{"kind":"Field","name":{"kind":"Name","value":"created_at"}},{"kind":"Field","name":{"kind":"Name","value":"updated_at"}},{"kind":"Field","name":{"kind":"Name","value":"conversation_product"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProductDetail"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MessageDetail"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"messages"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"conversation_id"}},{"kind":"Field","name":{"kind":"Name","value":"sender"}},{"kind":"Field","name":{"kind":"Name","value":"sender_name"}},{"kind":"Field","name":{"kind":"Name","value":"sender_avatar_url"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"message_type"}},{"kind":"Field","name":{"kind":"Name","value":"message_sender_type"}},{"kind":"Field","name":{"kind":"Name","value":"created_at"}},{"kind":"Field","name":{"kind":"Name","value":"updated_at"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"message_medias"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MessageMedia"}}]}}]}}]} as unknown as DocumentNode<GetConversationsQuery, GetConversationsQueryVariables>;
export const GetProductsByCollectionSlugDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"getProductsByCollectionSlug"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"slug"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}},"defaultValue":{"kind":"StringValue","value":"","block":false}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"products"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"where"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"product_collections"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"collections"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"slug"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"_eq"},"value":{"kind":"Variable","name":{"kind":"Name","value":"slug"}}}]}}]}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProductDetail"}},{"kind":"Field","name":{"kind":"Name","value":"product_prompts"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"prompts"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"PromptDetail"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"product_collections"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"collections"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CollectionDetail"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProductDetail"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"products"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"long_description"}},{"kind":"Field","name":{"kind":"Name","value":"technical_description"}},{"kind":"Field","name":{"kind":"Name","value":"image_url"}},{"kind":"Field","name":{"kind":"Name","value":"author"}},{"kind":"Field","name":{"kind":"Name","value":"greeting"}},{"kind":"Field","name":{"kind":"Name","value":"source_url"}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"inputs"}},{"kind":"Field","name":{"kind":"Name","value":"outputs"}},{"kind":"Field","name":{"kind":"Name","value":"nsfw"}},{"kind":"Field","name":{"kind":"Name","value":"created_at"}},{"kind":"Field","name":{"kind":"Name","value":"updated_at"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"PromptDetail"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"prompts"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"image_url"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CollectionDetail"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"collections"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]} as unknown as DocumentNode<GetProductsByCollectionSlugQuery, GetProductsByCollectionSlugQueryVariables>;
export const GetProductPromptsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"getProductPrompts"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"productSlug"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}},"defaultValue":{"kind":"StringValue","value":"","block":false}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"prompts"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"where"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"prompt_products"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"products"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"slug"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"_eq"},"value":{"kind":"Variable","name":{"kind":"Name","value":"productSlug"}}}]}}]}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"PromptDetail"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"PromptDetail"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"prompts"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"image_url"}}]}}]} as unknown as DocumentNode<GetProductPromptsQuery, GetProductPromptsQueryVariables>;
export const GetProductsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"getProducts"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"products"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProductDetail"}},{"kind":"Field","name":{"kind":"Name","value":"product_prompts"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"prompts"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"PromptDetail"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"product_collections"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"collections"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CollectionDetail"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProductDetail"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"products"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"long_description"}},{"kind":"Field","name":{"kind":"Name","value":"technical_description"}},{"kind":"Field","name":{"kind":"Name","value":"image_url"}},{"kind":"Field","name":{"kind":"Name","value":"author"}},{"kind":"Field","name":{"kind":"Name","value":"greeting"}},{"kind":"Field","name":{"kind":"Name","value":"source_url"}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"inputs"}},{"kind":"Field","name":{"kind":"Name","value":"outputs"}},{"kind":"Field","name":{"kind":"Name","value":"nsfw"}},{"kind":"Field","name":{"kind":"Name","value":"created_at"}},{"kind":"Field","name":{"kind":"Name","value":"updated_at"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"PromptDetail"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"prompts"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"image_url"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CollectionDetail"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"collections"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]} as unknown as DocumentNode<GetProductsQuery, GetProductsQueryVariables>;
export const GetProductsInDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"getProductsIn"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"_in"}},"type":{"kind":"ListType","type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},"defaultValue":{"kind":"StringValue","value":"","block":false}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"products"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"where"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"slug"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"_in"},"value":{"kind":"Variable","name":{"kind":"Name","value":"_in"}}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProductDetail"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProductDetail"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"products"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"long_description"}},{"kind":"Field","name":{"kind":"Name","value":"technical_description"}},{"kind":"Field","name":{"kind":"Name","value":"image_url"}},{"kind":"Field","name":{"kind":"Name","value":"author"}},{"kind":"Field","name":{"kind":"Name","value":"greeting"}},{"kind":"Field","name":{"kind":"Name","value":"source_url"}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"inputs"}},{"kind":"Field","name":{"kind":"Name","value":"outputs"}},{"kind":"Field","name":{"kind":"Name","value":"nsfw"}},{"kind":"Field","name":{"kind":"Name","value":"created_at"}},{"kind":"Field","name":{"kind":"Name","value":"updated_at"}}]}}]} as unknown as DocumentNode<GetProductsInQuery, GetProductsInQueryVariables>;
export const SubscribeMessageDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"subscribeMessage"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"uuid"}},"defaultValue":{"kind":"StringValue","value":"","block":false}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"messages_by_pk"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]} as unknown as DocumentNode<SubscribeMessageSubscription, SubscribeMessageSubscriptionVariables>;