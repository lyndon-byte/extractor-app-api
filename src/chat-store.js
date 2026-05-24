// chat-store.ts
import { db } from './db.js';
import { chats } from './schema.js';
import { eq,desc,and,sql } from 'drizzle-orm';

function getLastEmailSubject(messages) {
  // 1. Find the last message where role is 'assistant'
  const lastAssistantMessage = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");

  if (!lastAssistantMessage) return "No subject found";

  // 2. Find the part that contains the JSON text
  const textPart = lastAssistantMessage.parts.find((p) => p.type === "text");

  if (textPart && textPart.text) {
    try {
      // 3. Parse the stringified JSON
      const parsedData = JSON.parse(textPart.text);
      return parsedData.emailMessage?.emailSubject || "No subject found";
    } catch (e) {
      console.error("Failed to parse assistant message JSON", e);
      return "Invalid format";
    }
  }

  return "No subject found";
}


export async function saveChat({ 
  userId, 
  chatId, 
  messages 
}) {

  const subject = getLastEmailSubject(messages)

  await db.insert(chats)
    .values({ 
      userId, 
      chatId, 
      title: subject, 
      messages,
    })
    .onConflictDoUpdate({
      target: chats.chatId,
      set: { 
        title: subject, 
        messages, 
        updatedAt: new Date(), // Manual update for the timestamp
      },
    });
}

export async function getChatsByUserId({ 
  userId, 
  limit = 10, 
  page = 1 
}) {

  const offset = (page - 1) * limit;
  // Run both the data fetch and total count in parallel
  const [data, countResult] = await Promise.all([
    db
      .select({
        id: chats.id,
        chatId: chats.chatId,
        title: chats.title,
        updatedAt: chats.updatedAt,
      })
      .from(chats)
      .where(eq(chats.userId, userId))
      .orderBy(desc(chats.updatedAt))
      .limit(limit)
      .offset(offset),
      
    db
      .select({ count: sql`count(*)` })
      .from(chats)
      .where(eq(chats.userId, userId))
  ]);

  // Extract total count number (handling cases where table is empty)
  const totalItems = Number(countResult[0]?.count ?? 0);
  
  // Calculate total pages (minimum of 1 page)
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));

  return {
    data,
    pagination: {
      currentPage: page,
      limit,
      totalItems,
      totalPages,
    }
  };
}

export async function getMessagesByChatId({chatId,userId}) {
  
  const result = await db
    .select()
    .from(chats)
    .where(
      and(
        eq(chats.chatId, chatId),
        eq(chats.userId, userId)
      )
    )

  return result[0]?.messages || [];
  
}