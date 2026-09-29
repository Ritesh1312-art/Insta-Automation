export interface PrivateReplyPayload {
  instagramAccountId: string;
  commentId: string;
  messageText: string;
  accessToken: string;
}
export interface PublicReplyPayload { commentId: string; messageText: string; accessToken: string; }
export interface ApiResponse {
  success: boolean;
  responseId?: string;
  errorCategory?: 'TRANSIENT' | 'PERMANENT' | 'AUTHENTICATION' | 'PERMISSION' | 'RATE_LIMIT' | 'VALIDATION';
  errorMessage?: string;
}

function classifyError(data: any, status?: number): ApiResponse {
  const code = data?.error?.code;
  const subcode = data?.error?.error_subcode;
  const message = data?.error?.message || `Meta Graph API request failed${status ? ` (${status})` : ''}`;
  let errorCategory: ApiResponse['errorCategory'] = 'PERMANENT';
  if (code === 190) errorCategory = 'AUTHENTICATION';
  else if (code === 10 || code === 200) errorCategory = 'PERMISSION';
  else if (status === 429 || code === 4 || code === 17 || code === 32 || code === 613) errorCategory = 'RATE_LIMIT';
  else if ((status && status >= 500) || code === 1 || code === 2) errorCategory = 'TRANSIENT';
  else if (code === 100 || subcode === 33) errorCategory = 'VALIDATION';
  return { success: false, errorCategory, errorMessage: `[Meta API ${code ?? status ?? 'unknown'}] ${message}` };
}

export class InstagramMessagingService {
  private static get version(): string {
    const version = process.env.META_GRAPH_API_VERSION;
    if (!version || !/^v\d+\.\d+$/.test(version)) throw new Error('META_GRAPH_API_VERSION is required');
    return version;
  }

  private static async send(targetId: string, body: Record<string, unknown>, accessToken: string): Promise<ApiResponse> {
    try {
      const response = await fetch(
        `https://graph.facebook.com/${this.version}/${encodeURIComponent(targetId)}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(12_000),
        },
      );
      const data = await response.json().catch(() => ({}));
      return response.ok
        ? { success: true, responseId: data.message_id || data.id }
        : classifyError(data, response.status);
    } catch (error) {
      return {
        success: false,
        errorCategory: 'TRANSIENT',
        errorMessage: error instanceof Error ? error.message : 'Network failure',
      };
    }
  }

  public static sendPrivateReply(payload: PrivateReplyPayload): Promise<ApiResponse> {
    return this.send(
      payload.instagramAccountId,
      { recipient: { comment_id: payload.commentId }, message: { text: payload.messageText } },
      payload.accessToken,
    );
  }

  public static async sendPublicReply(payload: PublicReplyPayload): Promise<ApiResponse> {
    try {
      const response = await fetch(
        `https://graph.facebook.com/${this.version}/${encodeURIComponent(payload.commentId)}/replies`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${payload.accessToken}` },
          body: JSON.stringify({ message: payload.messageText }),
          signal: AbortSignal.timeout(12_000),
        },
      );
      const data = await response.json().catch(() => ({}));
      return response.ok
        ? { success: true, responseId: data.id }
        : classifyError(data, response.status);
    } catch (error) {
      return { success: false, errorCategory: 'TRANSIENT', errorMessage: error instanceof Error ? error.message : 'Network failure' };
    }
  }

  public static async getUserProfile(igsid: string, accessToken: string): Promise<{
    username?: string;
    name?: string;
    isUserFollowingBusiness?: boolean;
  } | null> {
    try {
      const fields = 'username,name,is_user_follow_business';
      const response = await fetch(
        `https://graph.facebook.com/${this.version}/${encodeURIComponent(igsid)}?fields=${encodeURIComponent(fields)}`,
        { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store', signal: AbortSignal.timeout(8_000) },
      );
      if (!response.ok) return null;
      const data = await response.json();
      return {
        username: typeof data.username === 'string' ? data.username : undefined,
        name: typeof data.name === 'string' ? data.name : undefined,
        isUserFollowingBusiness: data.is_user_follow_business === true,
      };
    } catch {
      return null;
    }
  }

  /** Resolves Page `feed` comment payloads to their canonical Instagram media ID. */
  public static async getCommentDetails(commentId: string, accessToken: string): Promise<{
    mediaId?: string;
    text?: string;
    commenterId?: string;
    commenterUsername?: string;
  } | null> {
    try {
      const fields = 'id,text,message,from{id,username},media{id}';
      const response = await fetch(
        `https://graph.facebook.com/${this.version}/${encodeURIComponent(commentId)}?fields=${encodeURIComponent(fields)}`,
        { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store', signal: AbortSignal.timeout(8_000) },
      );
      if (!response.ok) return null;
      const data = await response.json();
      return {
        mediaId: data.media?.id ? String(data.media.id) : undefined,
        text: typeof data.text === 'string' ? data.text : typeof data.message === 'string' ? data.message : undefined,
        commenterId: data.from?.id ? String(data.from.id) : undefined,
        commenterUsername: typeof data.from?.username === 'string' ? data.from.username : undefined,
      };
    } catch {
      return null;
    }
  }

  public static sendPrivateTemplateReply(payload: {
    instagramAccountId: string;
    commentId: string;
    templatePayload: unknown;
    accessToken: string;
  }): Promise<ApiResponse> {
    return this.send(
      payload.instagramAccountId,
      { recipient: { comment_id: payload.commentId }, message: payload.templatePayload },
      payload.accessToken,
    );
  }

  public static sendDirectMessage(payload: {
    recipientId: string;
    messageText: string;
    accessToken: string;
    instagramAccountId?: string;
  }): Promise<ApiResponse> {
    return this.send(
      payload.instagramAccountId || 'me',
      { recipient: { id: payload.recipientId }, message: { text: payload.messageText } },
      payload.accessToken,
    );
  }

  public static sendDirectTemplate(payload: {
    recipientId: string;
    templatePayload: unknown;
    accessToken: string;
    instagramAccountId?: string;
  }): Promise<ApiResponse> {
    return this.send(
      payload.instagramAccountId || 'me',
      { recipient: { id: payload.recipientId }, message: payload.templatePayload },
      payload.accessToken,
    );
  }
}
