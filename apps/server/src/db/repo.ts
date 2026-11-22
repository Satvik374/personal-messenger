import type { ConversationSummary, Message, User } from '@pm/shared'
import type { DbClient, DbValue } from './client.js'

export interface UserRecord {
  id: string
  username: string
  displayName: string
  accent: string
  lastSeenAt: number | null
  createdAt: number
  passwordHash: string
}

interface UserRow {
  id: string
  username: string
  display_name: string
  accent: string
  last_seen_at: number | null
  created_at: number
  password_hash: string
}

interface MessageRow {
  id: number
  conversation_id: string
  sender_id: string
  body: string
  client_id: string
  created_at: number
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    accent: row.accent,
    lastSeenAt: row.last_seen_at,
  }
}

function toUserRecord(row: UserRow): UserRecord {
  return { ...toUser(row), createdAt: row.created_at, passwordHash: row.password_hash }
}

function toMessage(row: MessageRow): Message {
  return {
    id: Number(row.id),
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    body: row.body,
    createdAt: Number(row.created_at),
    clientId: row.client_id,
  }
}

export interface SessionRecord {
  id: string
  userId: string
  tokenHash: string
  platform: string
  createdAt: number
  expiresAt: number
  revokedAt: number | null
  replacedBy: string | null
}

export class Repo {
  constructor(private readonly db: DbClient) {}

  // ---------------------------------------------------------------- users

  async createUser(input: {
    id: string
    username: string
    displayName: string
    passwordHash: string
    accent: string
  }): Promise<UserRecord> {
    const now = Date.now()
    await this.db.run(
      `INSERT INTO users (id, username, display_name, password_hash, accent, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [input.id, input.username, input.displayName, input.passwordHash, input.accent, now],
    )
    return {
      id: input.id,
      username: input.username,
      displayName: input.displayName,
      accent: input.accent,
      lastSeenAt: null,
      createdAt: now,
      passwordHash: input.passwordHash,
    }
  }

  async findUserByUsername(username: string): Promise<UserRecord | null> {
    const rows = await this.db.all<UserRow>(
      'SELECT * FROM users WHERE username = ? COLLATE NOCASE LIMIT 1',
      [username],
    )
    return rows[0] ? toUserRecord(rows[0]) : null
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const rows = await this.db.all<UserRow>('SELECT * FROM users WHERE id = ? LIMIT 1', [id])
    return rows[0] ? toUserRecord(rows[0]) : null
  }

  async setLastSeen(userId: string, at: number): Promise<void> {
    await this.db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', [at, userId])
  }

  // ------------------------------------------------------------- sessions

  async createSession(input: {
    id: string
    userId: string
    tokenHash: string
    platform: string
    expiresAt: number
  }): Promise<void> {
    await this.db.run(
      `INSERT INTO sessions (id, user_id, token_hash, platform, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [input.id, input.userId, input.tokenHash, input.platform, Date.now(), input.expiresAt],
    )
  }

  async findSessionByHash(tokenHash: string): Promise<SessionRecord | null> {
    const rows = await this.db.all<{
      id: string
      user_id: string
      token_hash: string
      platform: string
      created_at: number
      expires_at: number
      revoked_at: number | null
      replaced_by: string | null
    }>('SELECT * FROM sessions WHERE token_hash = ? LIMIT 1', [tokenHash])
    const row = rows[0]
    if (!row) return null
    return {
      id: row.id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      platform: row.platform,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      replacedBy: row.replaced_by,
    }
  }

  async attachReplacement(sessionId: string, replacementId: string): Promise<void> {
    await this.db.run('UPDATE sessions SET replaced_by = ? WHERE id = ?', [replacementId, sessionId])
  }

  async revokeSessionFamily(familyId: string): Promise<void> {
    await this.db.run(
      'UPDATE sessions SET revoked_at = ? WHERE (id = ? OR id IN (SELECT id FROM sessions WHERE replaced_by = ?)) AND revoked_at IS NULL',
      [Date.now(), familyId, familyId],
    )
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.db.run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [
      Date.now(),
      sessionId,
    ])
  }

  async deleteUser(userId: string): Promise<void> {
    await this.db.run('DELETE FROM users WHERE id = ?', [userId])
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [
      Date.now(),
      userId,
    ])
  }

  // -------------------------------------------------------------- invites

  async ensureInvite(code: string, createdBy: string | null): Promise<void> {
    await this.db.run(
      'INSERT INTO invites (code, created_by, created_at) VALUES (?, ?, ?) ON CONFLICT(code) DO NOTHING',
      [code, createdBy, Date.now()],
    )
  }

  async findInvite(code: string): Promise<{ code: string; expiresAt: number | null; usedBy: string | null } | null> {
    const rows = await this.db.all<{ code: string; expires_at: number | null; used_by: string | null }>(
      'SELECT code, expires_at, used_by FROM invites WHERE code = ? LIMIT 1',
      [code],
    )
    const row = rows[0]
    if (!row) return null
    return { code: row.code, expiresAt: row.expires_at, usedBy: row.used_by }
  }

  /** Atomically claims an unused invite. Returns false when it was already taken. */
  async consumeInvite(code: string, userId: string): Promise<boolean> {
    const result = await this.db.run(
      'UPDATE invites SET used_by = ? WHERE code = ? AND used_by IS NULL',
      [userId, code],
    )
    return result.rowsAffected > 0
  }

  // -------------------------------------------------------- conversations

  async addMember(conversationId: string, userId: string): Promise<void> {
    await this.db.run(
      'INSERT INTO members (conversation_id, user_id, joined_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
      [conversationId, userId, Date.now()],
    )
  }

  async isMember(conversationId: string, userId: string): Promise<boolean> {
    const rows = await this.db.all<{ ok: number }>(
      'SELECT 1 AS ok FROM members WHERE conversation_id = ? AND user_id = ? LIMIT 1',
      [conversationId, userId],
    )
    return rows.length > 0
  }

  async memberIds(conversationId: string): Promise<string[]> {
    const rows = await this.db.all<{ user_id: string }>(
      'SELECT user_id FROM members WHERE conversation_id = ?',
      [conversationId],
    )
    return rows.map((row) => row.user_id)
  }

  async conversationIdsFor(userId: string): Promise<string[]> {
    const rows = await this.db.all<{ conversation_id: string }>(
      'SELECT conversation_id FROM members WHERE user_id = ?',
      [userId],
    )
    return rows.map((row) => row.conversation_id)
  }

  async findGroupByTitle(title: string): Promise<string | null> {
    const rows = await this.db.all<{ id: string }>(
      "SELECT id FROM conversations WHERE kind = 'group' AND title = ? LIMIT 1",
      [title],
    )
    return rows[0]?.id ?? null
  }

  async createConversation(input: {
    id: string
    kind: 'dm' | 'group'
    title: string | null
    dmKey: string | null
    createdBy: string | null
  }): Promise<void> {
    await this.db.run(
      `INSERT INTO conversations (id, kind, title, dm_key, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [input.id, input.kind, input.title, input.dmKey, input.createdBy, Date.now()],
    )
  }

  async findConversationByDmKey(dmKey: string): Promise<string | null> {
    const rows = await this.db.all<{ id: string }>(
      'SELECT id FROM conversations WHERE dm_key = ? LIMIT 1',
      [dmKey],
    )
    return rows[0]?.id ?? null
  }

  async setConversationTitle(conversationId: string, title: string): Promise<void> {
    await this.db.run('UPDATE conversations SET title = ? WHERE id = ?', [title, conversationId])
  }

  async listConversations(userId: string): Promise<ConversationSummary[]> {
    const rows = await this.db.all<{
      id: string
      kind: 'dm' | 'group'
      title: string | null
      last_read_message_id: number
    }>(
      `SELECT c.id, c.kind, c.title, m.last_read_message_id
         FROM conversations c
         JOIN members m ON m.conversation_id = c.id
        WHERE m.user_id = ?`,
      [userId],
    )

    const summaries: ConversationSummary[] = []
    for (const row of rows) {
      const memberRows = await this.db.all<UserRow>(
        `SELECT u.* FROM users u
           JOIN members m ON m.user_id = u.id
          WHERE m.conversation_id = ?`,
        [row.id],
      )
      const lastRows = await this.db.all<MessageRow>(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1',
        [row.id],
      )
      const unreadRows = await this.db.all<{ count: number }>(
        `SELECT COUNT(*) AS count FROM messages
          WHERE conversation_id = ? AND id > ? AND sender_id <> ?`,
        [row.id, row.last_read_message_id, userId],
      )
      summaries.push({
        id: row.id,
        kind: row.kind,
        title: row.title,
        members: memberRows.map(toUser),
        lastMessage: lastRows[0] ? toMessage(lastRows[0]) : null,
        lastReadMessageId: Number(row.last_read_message_id),
        unreadCount: Number(unreadRows[0]?.count ?? 0),
      })
    }

    summaries.sort((a, b) => (b.lastMessage?.id ?? 0) - (a.lastMessage?.id ?? 0))
    return summaries
  }

  async getConversation(conversationId: string, viewerId: string): Promise<ConversationSummary | null> {
    const all = await this.listConversations(viewerId)
    return all.find((conversation) => conversation.id === conversationId) ?? null
  }

  // -------------------------------------------------------------- messages

  async insertMessage(input: {
    conversationId: string
    senderId: string
    body: string
    clientId: string
  }): Promise<{ message: Message; duplicate: boolean }> {
    const existing = await this.db.all<MessageRow>(
      'SELECT * FROM messages WHERE sender_id = ? AND client_id = ? LIMIT 1',
      [input.senderId, input.clientId],
    )
    if (existing[0]) return { message: toMessage(existing[0]), duplicate: true }

    const createdAt = Date.now()
    const result = await this.db.run(
      `INSERT INTO messages (conversation_id, sender_id, body, client_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [input.conversationId, input.senderId, input.body, input.clientId, createdAt],
    )
    return {
      message: {
        id: Number(result.lastInsertRowid),
        conversationId: input.conversationId,
        senderId: input.senderId,
        body: input.body,
        createdAt,
        clientId: input.clientId,
      },
      duplicate: false,
    }
  }

  async getMessages(
    conversationId: string,
    options: { before?: number; limit: number },
  ): Promise<{ messages: Message[]; hasMore: boolean }> {
    const limit = Math.min(Math.max(options.limit, 1), 200)
    const args: DbValue[] = [conversationId]
    let sql = 'SELECT * FROM messages WHERE conversation_id = ?'
    if (options.before !== undefined) {
      sql += ' AND id < ?'
      args.push(options.before)
    }
    sql += ' ORDER BY id DESC LIMIT ?'
    args.push(limit + 1)

    const rows = await this.db.all<MessageRow>(sql, args)
    const hasMore = rows.length > limit
    const page = rows.slice(0, limit).map(toMessage)
    page.reverse()
    return { messages: page, hasMore }
  }

  async syncMessages(
    userId: string,
    since: number,
    conversationId: string | null,
    limit: number,
  ): Promise<{ messages: Message[]; hasMore: boolean }> {
    const args: DbValue[] = [userId, since]
    let sql = `SELECT msg.* FROM messages msg
                 JOIN members m ON m.conversation_id = msg.conversation_id
                WHERE m.user_id = ? AND msg.id > ?`
    if (conversationId) {
      sql += ' AND msg.conversation_id = ?'
      args.push(conversationId)
    }
    sql += ' ORDER BY msg.id ASC LIMIT ?'
    args.push(limit + 1)

    const rows = await this.db.all<MessageRow>(sql, args)
    const hasMore = rows.length > limit
    return { messages: rows.slice(0, limit).map(toMessage), hasMore }
  }

  async markRead(conversationId: string, userId: string, messageId: number): Promise<void> {
    await this.db.run(
      `UPDATE members
          SET last_read_message_id = CASE WHEN last_read_message_id < ? THEN ? ELSE last_read_message_id END
        WHERE conversation_id = ? AND user_id = ?`,
      [messageId, messageId, conversationId, userId],
    )
  }

  // --------------------------------------------------------------- devices

  async upsertDevice(input: {
    id: string
    userId: string
    platform: 'android' | 'desktop'
    fcmToken: string | null
  }): Promise<void> {
    if (input.fcmToken) {
      await this.db.run('DELETE FROM devices WHERE fcm_token = ?', [input.fcmToken])
    }
    await this.db.run(
      `INSERT INTO devices (id, user_id, platform, fcm_token, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [input.id, input.userId, input.platform, input.fcmToken, Date.now(), Date.now()],
    )
  }

  async deleteDevice(userId: string, deviceId: string): Promise<void> {
    await this.db.run('DELETE FROM devices WHERE id = ? AND user_id = ?', [deviceId, userId])
  }

  async deleteDeviceByToken(fcmToken: string): Promise<void> {
    await this.db.run('DELETE FROM devices WHERE fcm_token = ?', [fcmToken])
  }

  async androidTokensForUsers(userIds: string[]): Promise<{ userId: string; token: string }[]> {
    if (userIds.length === 0) return []
    const placeholders = userIds.map(() => '?').join(', ')
    const rows = await this.db.all<{ user_id: string; fcm_token: string | null }>(
      `SELECT user_id, fcm_token FROM devices
        WHERE platform = 'android' AND fcm_token IS NOT NULL AND user_id IN (${placeholders})`,
      userIds,
    )
    return rows
      .filter((row): row is { user_id: string; fcm_token: string } => Boolean(row.fcm_token))
      .map((row) => ({ userId: row.user_id, token: row.fcm_token }))
  }
}
