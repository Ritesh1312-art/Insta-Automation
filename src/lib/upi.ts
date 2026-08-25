export function publicUpiConfig() {
  return {
    upiId: (process.env.UPI_ID || '').trim(),
    payeeName: (process.env.UPI_PAYEE_NAME || 'InstaDM Auto').trim() || 'InstaDM Auto',
    note: (process.env.UPI_NOTE || 'InstaDM plan payment').trim(),
  };
}

export function buildUpiUri(params: { upiId: string; payeeName: string; amount: number; note?: string }) {
  const search = new URLSearchParams({
    pa: params.upiId,
    pn: params.payeeName,
    am: String(params.amount),
    cu: 'INR',
    tn: params.note || 'InstaDM plan payment',
  });
  return `upi://pay?${search.toString()}`;
}

export function isValidUtr(value: string) {
  return /^[A-Za-z0-9]{12,22}$/.test(value.trim());
}

export function isValidUpiId(value: string) {
  return /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(value.trim());
}
