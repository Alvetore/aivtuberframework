import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const viewers = sqliteTable('viewers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  twitchId: text('twitch_id').notNull().unique(),
  username: text('username').notNull(),
  firstSeen: text('first_seen').notNull(),
  lastSeen: text('last_seen').notNull(),
  messageCount: integer('message_count').notNull().default(0),
});

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    viewerId: integer('viewer_id').references(() => viewers.id, { onDelete: 'cascade' }),
    username: text('username').notNull(),
    message: text('message').notNull(),
    timestamp: text('timestamp').notNull(),
    isBotResponse: integer('is_bot_response', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => ({
    tsIdx: index('idx_messages_timestamp').on(t.timestamp),
    viewerIdx: index('idx_messages_viewer').on(t.viewerId),
  }),
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  startTime: text('start_time').notNull(),
  endTime: text('end_time'),
  messageCount: integer('message_count').notNull().default(0),
  profileId: text('profile_id'),
  legacy: integer('legacy', { mode:'boolean' }).notNull().default(true),
});

export const profiles=sqliteTable('profiles',{
  id:text('id').primaryKey(),name:text('name').notNull(),settings:text('settings').notNull(),createdAt:text('created_at').notNull(),legacyContext:integer('legacy_context').notNull().default(0),
});
export const workspaceState=sqliteTable('workspace_state',{key:text('key').primaryKey(),value:text('value').notNull()});
export const messageContext=sqliteTable('message_context',{
  messageId:text('message_id').primaryKey(),profileId:text('profile_id').notNull(),sessionId:integer('session_id'),source:text('source').notNull(),replyToId:text('reply_to_id'),operationId:text('operation_id'),
},t=>({profileIdx:index('idx_message_context_profile').on(t.profileId,t.source),sessionIdx:index('idx_message_context_session').on(t.sessionId)}));
export const operations=sqliteTable('operations',{
  id:text('id').primaryKey(),profileId:text('profile_id').notNull(),sessionId:integer('session_id'),source:text('source').notNull(),createdAt:text('created_at').notNull(),data:text('data').notNull(),
},t=>({sessionIdx:index('idx_operations_session').on(t.sessionId,t.createdAt),profileIdx:index('idx_operations_profile').on(t.profileId,t.createdAt)}));
