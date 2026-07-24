export interface PrivateReplyPayload { instagramAccountId: string; commentId: string; messageText: string; accessToken: string; }
export interface PublicReplyPayload { commentId: string; messageText: string; accessToken: string; }
export interface ApiResponse {
  success: boolean; responseId?: string;
  errorCategory?: 'TRANSIENT' | 'PERMANENT' | 'AUTHENTICATION' | 'PERMISSION' | 'RATE_LIMIT' | 'VALIDATION';
  errorMessage?: string;
}

function classifyError(data: any): ApiResponse {
  const code = data?.error?.code;
  const subcode = data?.error?.error_subcode;
  const message = data?.error?.message || 'Meta Graph API request failed';
  let errorCategory: ApiResponse['errorCategory'] = 'PERMANENT';
  if (code === 190) errorCategory = 'AUTHENTICATION';
  else if (code === 10 || code === 200) errorCategory = 'PERMISSION';
  else if (code === 4 || code === 17 || code === 32 || code === 613) errorCategory = 'RATE_LIMIT';
  else if (code === 100 || subcode === 33) errorCategory = 'VALIDATION';
  return { success: false, errorCategory, errorMessage: `[Meta API ${code ?? 'unknown'}] ${message}` };
}

export class InstagramMessagingService {
  private static get version(): string {
    const version = process.env.META_GRAPH_API_VERSION;
    if (!version) throw new Error('META_GRAPH_API_VERSION is required');
    return version;
  }

  public static async sendPrivateReply(payload: PrivateReplyPayload): Promise<ApiResponse> {
    try {
      const response = await fetch(`https://graph.facebook.com/${this.version}/me/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${payload.accessToken}` },
        body: JSON.stringify({ recipient: { comment_id: payload.commentId }, message: { text: payload.messageText } }),
      });
      const data = await response.json();
      return response.ok ? { success: true, responseId: data.id || data.message_id } : classifyError(data);
    } catch (error) {
      return { success: false, errorCategory: 'TRANSIENT', errorMessage: error instanceof Error ? error.message : 'Network failure' };
    }
  }

  public static async sendPublicReply(payload: PublicReplyPayload): Promise<ApiResponse> {
    try {
      const response = await fetch(`https://graph.facebook.com/${this.version}/${payload.commentId}/replies`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${payload.accessToken}` },
        body: JSON.stringify({ message: payload.messageText }),
      });
      const data = await response.json();
      return response.ok ? { success: true, responseId: data.id } : classifyError(data);
    } catch (error) {
      return { success: false, errorCategory: 'TRANSIENT', errorMessage: error instanceof Error ? error.message : 'Network failure' };
    }
  }

  public static async getUserProfile(igsid: string, accessToken: string): Promise<{ username?: string; is_user_follow_business?: boolean } | null> {
    try {
      const response = await fetch(`https://graph.facebook.com/${this.version}/${igsid}?fields=username,is_user_follow_business`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store'
      });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  public static async sendPrivateTemplateReply(payload: { instagramAccountId: string; commentId: string; templatePayload: any; accessToken: string }): Promise<ApiResponse> {
    try {
      const response = await fetch(`https://graph.facebook.com/${this.version}/me/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${payload.accessToken}` },
        body: JSON.stringify({
          recipient: { comment_id: payload.commentId },
          message: payload.templatePayload
        }),
      });
      const data = await response.json();
      return response.ok ? { success: true, responseId: data.id || data.message_id } : classifyError(data);
    } catch (error) {
      return { success: false, errorCategory: 'TRANSIENT', errorMessage: error instanceof Error ? error.message : 'Network failure' };
    }
  }

  public static async sendDirectMessage(payload: { recipientId: string; messageText: string; accessToken: string }): Promise<ApiResponse> {
    try {
      const response = await fetch(`https://graph.facebook.com/${this.version}/me/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${payload.accessToken}` },
        body: JSON.stringify({
          recipient: { id: payload.recipientId },
          message: { text: payload.messageText }
        }),
      });
      const data = await response.json();
      return response.ok ? { success: true, responseId: data.message_id || data.id } : classifyError(data);
    } catch (error) {
      return { success: false, errorCategory: 'TRANSIENT', errorMessage: error instanceof Error ? error.message : 'Network failure' };
    }
  }
}
