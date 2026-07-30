import Razorpay from 'razorpay';
import crypto from 'crypto';

export class RazorpayService {
  private static get instance() {
    const key_id = process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder_key';
    const key_secret = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_placeholder_secret';
    return new Razorpay({ key_id, key_secret });
  }

  public static async createSubscription(payload: { planId: string; customerEmail: string; customerName?: string }) {
    try {
      const subscription = await this.instance.subscriptions.create({
        plan_id: payload.planId,
        total_count: 12,
        quantity: 1,
        customer_notify: 1,
        notes: {
          email: payload.customerEmail,
          app: 'InstaPulse'
        }
      });
      return { success: true, subscription };
    } catch (error: any) {
      return { success: false, error: error.message || 'Razorpay subscription creation failed' };
    }
  }

  public static verifyPaymentSignature(payload: {
    razorpay_payment_id: string;
    razorpay_subscription_id: string;
    razorpay_signature: string;
  }): boolean {
    const key_secret = process.env.RAZORPAY_KEY_SECRET || '';
    if (!key_secret) return false;
    const body = payload.razorpay_payment_id + '|' + payload.razorpay_subscription_id;
    const expectedSignature = crypto
      .createHmac('sha256', key_secret)
      .update(body.toString())
      .digest('hex');
    return expectedSignature === payload.razorpay_signature;
  }
}
