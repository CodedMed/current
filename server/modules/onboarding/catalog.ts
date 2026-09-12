import type { BusinessTypeId, BusinessTypeOption, FeatureId, FeatureOption, OnboardingCatalog } from '../../../shared/types.ts';

/**
 * Predefined onboarding options. This is the "mock data" behind the two
 * onboarding questions; a CMS or database can replace it later without
 * changing the API shape.
 */

export const BUSINESS_TYPES: readonly BusinessTypeOption[] = [
  {
    id: 'retail',
    label: 'Retail',
    description: 'Storefront or showroom selling goods in person.',
    icon: 'store',
    examples: 'Boutiques, hardware stores, specialty shops',
  },
  {
    id: 'professional_services',
    label: 'Professional Services',
    description: 'Licensed or specialised services billed to clients.',
    icon: 'briefcase',
    examples: 'Accounting, legal, design studios, agencies',
  },
  {
    id: 'consulting',
    label: 'Consulting',
    description: 'Advisory work on retainers and project milestones.',
    icon: 'lightbulb',
    examples: 'Strategy, IT, HR, management consulting',
  },
  {
    id: 'construction',
    label: 'Construction',
    description: 'Contracting with materials, crews, and progress billing.',
    icon: 'hard-hat',
    examples: 'General contractors, trades, remodelers',
  },
  {
    id: 'restaurant',
    label: 'Restaurant / Food Service',
    description: 'Daily sales with tight margins and frequent supplier runs.',
    icon: 'utensils',
    examples: 'Restaurants, cafés, caterers, food trucks',
  },
  {
    id: 'ecommerce',
    label: 'E-commerce',
    description: 'Online sales with marketplace payouts and ad spend.',
    icon: 'shopping-cart',
    examples: 'Shopify, Amazon, Etsy, DTC brands',
  },
  {
    id: 'freelance',
    label: 'Freelance / Contracting',
    description: 'Solo work invoiced per project or retainer.',
    icon: 'pen-tool',
    examples: 'Designers, developers, writers, photographers',
  },
  {
    id: 'other',
    label: 'Other',
    description: 'Something else. We will start with a general setup.',
    icon: 'sparkles',
    examples: 'Nonprofits, studios, mixed businesses',
  },
];

export const FEATURES: readonly FeatureOption[] = [
  {
    id: 'receivables',
    label: 'Income & receivables',
    description: 'Track what is coming in and who still owes you.',
    icon: 'arrow-down-to-line',
    recommendedFor: ['professional_services', 'consulting', 'construction', 'freelance', 'other'],
  },
  {
    id: 'expenses',
    label: 'Expenses & bills',
    description: 'See every outflow and never miss a due date.',
    icon: 'receipt',
    recommendedFor: ['retail', 'professional_services', 'consulting', 'construction', 'restaurant', 'ecommerce', 'freelance', 'other'],
  },
  {
    id: 'invoices',
    label: 'Invoices',
    description: 'Send, track, and chase invoices from one place.',
    icon: 'file-text',
    recommendedFor: ['professional_services', 'consulting', 'construction', 'freelance'],
  },
  {
    id: 'vendor_payments',
    label: 'Vendor payments',
    description: 'Schedule and approve payments to suppliers and subs.',
    icon: 'truck',
    recommendedFor: ['retail', 'construction', 'restaurant', 'ecommerce'],
  },
  {
    id: 'forecasting',
    label: 'Cash-flow forecasting',
    description: 'A 30-day projection of your balance, updated daily.',
    icon: 'trending-up',
    recommendedFor: ['retail', 'construction', 'restaurant', 'ecommerce', 'consulting'],
  },
  {
    id: 'reporting',
    label: 'Financial reporting',
    description: 'Clean monthly summaries for you, your accountant, or a lender.',
    icon: 'bar-chart-3',
    recommendedFor: ['professional_services', 'consulting', 'ecommerce', 'other'],
  },
  {
    id: 'cash_management',
    label: 'Business cash management',
    description: 'Keep operating cash, reserves, and card balances in balance.',
    icon: 'landmark',
    recommendedFor: ['retail', 'restaurant', 'ecommerce', 'construction'],
  },
  {
    id: 'automation',
    label: 'Automated financial workflows',
    description: 'Reminders, sweeps, and approvals that run themselves.',
    icon: 'workflow',
    recommendedFor: ['ecommerce', 'professional_services', 'consulting'],
  },
];

export const catalog: OnboardingCatalog = {
  businessTypes: [...BUSINESS_TYPES],
  features: [...FEATURES],
};

export function businessTypeLabel(id: BusinessTypeId): string {
  return BUSINESS_TYPES.find((b) => b.id === id)?.label ?? id;
}

export function featureLabel(id: FeatureId): string {
  return FEATURES.find((f) => f.id === id)?.label ?? id;
}

export function recommendedFeatures(businessType: BusinessTypeId): FeatureId[] {
  return FEATURES.filter((f) => f.recommendedFor.includes(businessType)).map((f) => f.id);
}
