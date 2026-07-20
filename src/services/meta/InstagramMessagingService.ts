export interface PrivateReplyPayload {
  commentId: string;
  messageText: string;
  accessToken: string;
}

export interface PublicReplyPayload {
  commentId: string;
  messageText: string;
  accessToken: string;
}

export interface ApiResponse {
  success: boolean;
  responseId?: string;
  errorCategory?: 'TRANSIENT' | 'PERMANENT' | 'AUTHENTICATION' | 'PERMISSION' | 'RATE_LIMIT' | 'VALIDATION';
  errorMessage?: string;
}

export class InstagramMessagingService {
  private static graphApiVersion = process.env.META_GRAPH_API_VERSION || 'v19.0';

  /**
   * Sends an official Instagram Private Reply to a comment.
   * Note: Meta allows maximum 1 private reply per comment, within 7 days of the comment.
   */
  public static async sendPrivateReply(payload: PrivateReplyPayload): Promise<ApiResponse> {
    if (process.env.META_API_MOCK === 'true') {
      console.log(`🤖 [META MOCK MODE] Sending Private Reply DM for comment ${payload.commentId}: "${payload.messageText}"`);
      return {
        success: true,
        responseId: `mock_msg_resp_${Date.now()}`,
      };
    }

    const url = `https://graph.facebook.com/${this.graphApiVersion}/${payload.commentId}/private_replies`;
    
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: payload.messageText,
          access_token: payload.accessToken,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        const errCode = data.error?.code;
        const errSubcode = data.error?.error_subcode;
        const errMessage = data.error?.message || 'Meta API error sending private reply';

        let category: ApiResponse['errorCategory'] = 'PERMANENT';

        if (errCode === 190) category = 'AUTHENTICATION';
        else if (errCode === 10 || errCode === 200) category = 'PERMISSION';
        else if (errCode === 4 || errCode === 17) category = 'RATE_LIMIT';
        else if (errCode === 100 && (errSubcode === 33 || errMessage.includes('7 days'))) category = 'VALIDATION';

        return {
          success: false,
          errorCategory: category,
          errorMessage: `[Meta API Error ${errCode}]: ${errMessage}`,
        };
      }

      return {
        success: true,
        responseId: data.id || data.message_id || `msg_ok_${Date.now()}`,
      };
    } catch (error: any) {
      return {
        success: false,
        errorCategory: 'TRANSIENT',
        errorMessage: error.message || 'Network exception while communicating with Meta Graph API',
      };
    }
  }

  /**
   * Optional Public Comment Reply (e.g., "Check your DMs 📩")
   */
  public static async sendPublicReply(payload: PublicReplyPayload): Promise<ApiResponse> {
    if (process.env.META_API_MOCK === 'true') {
      console.log(`🤖 [META MOCK MODE] Sending Public Reply for comment ${payload.commentId}: "${payload.messageText}"`);
      return {
        success: true,
        responseId: `mock_public_reply_${Date.now()}`,
      };
    }

    const url = `https://graph.facebook.com/${this.graphApiVersion}/${payload.commentId}/replies`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: payload.messageText,
          access_token: payload.accessToken,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        return {
          success: false,
          errorCategory: 'PERMANENT',
          errorMessage: data.error?.message || 'Failed to post public comment reply',
        };
      }

      return {
        success: true,
        responseId: data.id,
      };
    } catch (error: any) {
      return {
        success: false,
        errorCategory: 'TRANSIENT',
        errorMessage: error.message,
      };
    }
  }
}
