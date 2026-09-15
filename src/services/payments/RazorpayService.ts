import Razorpay from 'razorpay';
import crypto from 'crypto';

export class RazorpayService {
  private static get instance() {
    const key_id = process.env.RAZORPAY_KEY_ID;
    const key_secret = process.env.RAZORPAY_KEY_SECRET;
    if (!key_id || !key_secret) throw new Error('Razorpay is not configured');
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
    razorpay_subscription_id?: string;
    razorpay_order_id?: string;
    razorpay_signature: string;
  }): boolean {
    const key_secret = process.env.RAZORPAY_KEY_SECRET || '';
    if (!key_secret || !payload.razorpay_signature) return false;
    // Razorpay signs `order_id|payment_id` for one-time orders and
    // `payment_id|subscription_id` for subscriptions.
    const body = payload.razorpay_order_id
      ? `${payload.razorpay_order_id}|${payload.razorpay_payment_id}`
      : `${payload.razorpay_payment_id}|${payload.razorpay_subscription_id}`;
    const expectedSignature = crypto
      .createHmac('sha256', key_secret)
      .update(body)
      .digest('hex');
    try {
      const expected = Buffer.from(expectedSignature, 'hex');
      const received = Buffer.from(payload.razorpay_signature, 'hex');
      return expected.length === received.length && crypto.timingSafeEqual(expected, received);
    } catch {
      return false;
    }
  }
}
