export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: unknown; // string or content block array
}

const conversations = new Map<number, ConversationMessage[]>();

export function getMessages(cardId: number): ConversationMessage[] {
  return conversations.get(cardId) ?? [];
}

export function addUserMessage(cardId: number, content: string): void {
  const msgs = conversations.get(cardId) ?? [];
  msgs.push({ role: 'user', content });
  conversations.set(cardId, msgs);
}

export function addAssistantMessage(cardId: number, content: unknown): void {
  const msgs = conversations.get(cardId) ?? [];
  msgs.push({ role: 'assistant', content });
  conversations.set(cardId, msgs);
}

export function clearConversation(cardId: number): void {
  conversations.delete(cardId);
}
