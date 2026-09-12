import type { CreditProfile, LoanCost, LoanImpact, LoanPricing } from './types.ts';

/**
 * Loan math shared by the server (to price offers) and the client (to re-price
 * when the user changes the amount), so both always agree.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export function amortizedPayment(principal: number, apr: number, months: number): number {
  const r = apr / 100 / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - (1 + r) ** -months);
}

export function costOfOffer(pricing: LoanPricing, amount: number): LoanCost {
  const origination = (amount * pricing.originationPct) / 100;
  switch (pricing.kind) {
    case 'amortized': {
      const months = pricing.termMonths ?? 12;
      const payment = amortizedPayment(amount, pricing.apr ?? 0, months);
      const totalRepayment = payment * months;
      return { monthlyPayment: round2(payment), totalRepayment: round2(totalRepayment), totalCost: round2(totalRepayment - amount + origination), payoffMonths: months };
    }
    case 'revolving': {
      // Assume the full line is drawn for a year and interest is paid monthly.
      const interest = (amount * (pricing.apr ?? 0)) / 100 / 12;
      return { monthlyPayment: round2(interest), totalRepayment: round2(amount + interest * 12), totalCost: round2(interest * 12 + pricing.annualFee + origination), payoffMonths: null };
    }
    case 'revenue_share': {
      const totalRepayment = amount * (1 + (pricing.flatFeePct ?? 0) / 100);
      const remittance = ((pricing.holdbackPct ?? 0) / 100) * (pricing.remittanceBase ?? 0);
      const payoffMonths = remittance > 0 ? Math.ceil(totalRepayment / remittance) : null;
      return { monthlyPayment: remittance > 0 ? round2(remittance) : null, totalRepayment: round2(totalRepayment), totalCost: round2(totalRepayment - amount), payoffMonths };
    }
    case 'charge_card':
      return { monthlyPayment: null, totalRepayment: amount, totalCost: round2(pricing.annualFee), payoffMonths: null };
  }
}

export function estimateImpact(profile: Pick<CreditProfile, 'totalCash' | 'monthlyBurn' | 'runwayMonths' | 'lowestProjectedCash' | 'monthsToLowest'>, cost: LoanCost, amount: number): LoanImpact {
  const payment = cost.monthlyPayment ?? 0;
  let runwayMonthsAdded: number | null = null;
  if (profile.runwayMonths !== null && profile.monthlyBurn > 0) {
    const after = (profile.totalCash + amount) / (profile.monthlyBurn + payment);
    runwayMonthsAdded = Math.round((after - profile.runwayMonths) * 10) / 10;
  }
  const lowestProjectedCashAfter = Math.round(profile.lowestProjectedCash + amount - payment * profile.monthsToLowest);
  return { runwayMonthsAdded, lowestProjectedCashAfter };
}
