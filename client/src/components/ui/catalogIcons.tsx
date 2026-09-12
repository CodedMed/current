import {
  ArrowDownToLine,
  BarChart3,
  Briefcase,
  FileText,
  HardHat,
  Landmark,
  Lightbulb,
  PenTool,
  Receipt,
  ShoppingCart,
  Sparkles,
  Store,
  TrendingUp,
  Truck,
  Utensils,
  Workflow,
  type LucideProps,
} from 'lucide-react';
import type { ComponentType } from 'react';

/** Icon names served by the onboarding catalog, resolved to lucide components. */
const ICONS: Record<string, ComponentType<LucideProps>> = {
  store: Store,
  briefcase: Briefcase,
  lightbulb: Lightbulb,
  'hard-hat': HardHat,
  utensils: Utensils,
  'shopping-cart': ShoppingCart,
  'pen-tool': PenTool,
  sparkles: Sparkles,
  'arrow-down-to-line': ArrowDownToLine,
  receipt: Receipt,
  'file-text': FileText,
  truck: Truck,
  'trending-up': TrendingUp,
  'bar-chart-3': BarChart3,
  landmark: Landmark,
  workflow: Workflow,
};

export function CatalogIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Sparkles;
  return <Icon className={className} aria-hidden="true" />;
}
