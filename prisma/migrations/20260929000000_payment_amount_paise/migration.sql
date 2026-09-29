-- Store payment amounts as integer paise. Existing Float values were stored in INR.
ALTER TABLE "DirectUpiPayment"
  ALTER COLUMN "amount" TYPE INTEGER
  USING ROUND("amount" * 100)::INTEGER;
