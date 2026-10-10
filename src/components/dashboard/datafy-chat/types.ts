export type DatafyConversationRow = {
    id: string;
    channelId: string;
    waId: string;
    contactName: string | null;
    lastMessagePreview: string | null;
    lastMessageAt: string | null;
    lastCustomerMessageAt: string | null;
    unreadCount: number;
    status: string;
    assignedToId: string | null;
    assignedAt: string | null;
    assignedTo: { id: string; name: string | null; email: string } | null;
};

export type DatafyMessageRow = {
    id: string;
    conversationId: string;
    wamid: string | null;
    clientMessageId: string | null;
    direction: string;
    type: string;
    body: string | null;
    caption: string | null;
    mediaId: string | null;
    mediaUrl: string | null;
    mediaMimeType: string | null;
    mediaFilename: string | null;
    status: string;
    errorMessage: string | null;
    sentByUserId: string | null;
    providerTimestamp: string | null;
    deliveredAt: string | null;
    readAt: string | null;
    createdAt: string;
};

export type ServiceWindow = {
    open: boolean;
    expiresAt: string | null;
    lastCustomerMessageAt: string | null;
};
