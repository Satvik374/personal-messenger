/**
 * Cross-layer navigation signal. The Android shell dispatches it when a push
 * notification is tapped; the chat screen listens and opens that conversation.
 */
export const chatEvents = new EventTarget()

export function requestOpenConversation(conversationId: string): void {
  chatEvents.dispatchEvent(new CustomEvent('open-conversation', { detail: conversationId }))
}
