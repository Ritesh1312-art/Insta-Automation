export function publicUpiConfig() {
  return {
    upiId: (process.env.UPI_ID || '').trim(),
    payeeName: (process.env.UPI_PAYEE_NAME || 'InstaDM Auto').trim() || 'InstaDM Auto',
    note: (process.env.UPI_NOTE || 'InstaDM plan payment').trim(),
  };
}

export function buildUpiUri(params: { upiId: string; payeeName: string; amount: number; note?: string }) {
  const parts = [
    `pa=${encodeURIComponent(params.upiId.trim())}`,
    `pn=${encodeURIComponent(params.payeeName.trim() || 'InstaDM Auto')}`,
    `am=${encodeURIComponent(String(params.amount))}`,
    'cu=INR',
    `tn=${encodeURIComponent(params.note || 'InstaDM plan payment')}`,
  ];
  return `upi://pay?${parts.join('&')}`;
}

export function isValidUtr(value: string) {
  return /^[A-Za-z0-9]{12,22}$/.test(value.trim());
}

export function isValidUpiId(value: string) {
  return /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(value.trim());
}
