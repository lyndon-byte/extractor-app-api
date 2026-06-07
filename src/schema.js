import { pgTable,pgEnum, text, timestamp, jsonb, serial,varchar,integer,primaryKey } from 'drizzle-orm/pg-core';

export const chats = pgTable('chats', {

    id: serial('id').primaryKey(),
    userId: text('user_id'), 
    chatId: text('chat_id').unique().notNull(),
    title: text('title').notNull(),
    messages: jsonb('messages').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(), 
    
});

export const subscriptionStatusEnum = pgEnum(
  'subscription_status',
  ['active', 'expired', 'cancelled']
);

export const subscriptions = pgTable('subscriptions', {

  id: serial('id').primaryKey(),
  userId: text('user_id').notNull(),
  subscriptionId: varchar('subscription_id',{length: 255}).notNull(),
  name: varchar('name', {length: 255}).notNull(),
  email: varchar('email', {length: 255}).notNull(),
  status: subscriptionStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

});

export const messageUsage = pgTable("message_usage", {

    userId: text("user_id").notNull(),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    messageCount: integer("message_count").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.year, table.month],
    }),
  ]
)