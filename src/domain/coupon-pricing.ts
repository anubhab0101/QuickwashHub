export function calculateVehicleCouponDiscount(input: {
  grossAmount: number;
  baseCommission: number;
  vehicleTypes: string[];
  couponDiscountPct: number;
  paymentFeePct: number;
  minimumContributionPct: number;
}) {
  const { grossAmount, baseCommission } = input;
  if (!Number.isSafeInteger(grossAmount) || grossAmount < 1 || !Number.isSafeInteger(baseCommission) || baseCommission < 0) throw new Error('Gross amount and commission must be non-negative paise amounts.');
  const count = input.vehicleTypes.length;
  if (count < 1 || count > 5) throw new Error('A coupon order must contain one to five vehicles.');
  const uniqueTypes = new Set(input.vehicleTypes);
  const quantityPct = count >= 5 ? 30 : count >= 3 ? 25 : count === 2 ? 15 : 10;
  const eligiblePct = uniqueTypes.size > 1 ? Math.max(20, quantityPct) : quantityPct;
  const offerPct = Math.max(eligiblePct, Math.max(0, input.couponDiscountPct));
  const feePct = Math.min(100, Math.max(0, input.paymentFeePct));
  const minimumPct = Math.min(100, Math.max(0, input.minimumContributionPct));
  const paymentFeeBuffer = Math.round(grossAmount * feePct / 100);
  const minimumContribution = Math.max(1, Math.round(grossAmount * minimumPct / 100));
  const safeCap = Math.max(0, baseCommission - paymentFeeBuffer - minimumContribution);
  const discount = Math.min(Math.round(grossAmount * offerPct / 100), safeCap);
  return { eligiblePct, offerPct, discount, safeCap, paymentFeeBuffer, minimumContribution, remainingContribution: baseCommission - discount - paymentFeeBuffer };
}
