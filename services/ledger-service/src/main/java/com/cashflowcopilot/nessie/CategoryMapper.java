package com.cashflowcopilot.nessie;

import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Deterministic category and counterparty rules for bank records. Mirrors the rules the current.surf
 * dashboard applies in {@code server/modules/cashflow/nessie/nessieLedger.ts} so both views of the
 * same bank feed agree on what a movement was for. Output is always a snake_case category id.
 */
public final class CategoryMapper {

    private static final Pattern SNAKE_CASE = Pattern.compile("^[a-z][a-z0-9_]*$");

    private static final Map<String, String> MERCHANT_CATEGORY = Map.ofEntries(
            Map.entry("inventory", "inventory"),
            Map.entry("packaging & supplies", "supplies"),
            Map.entry("supplies", "supplies"),
            Map.entry("office supplies", "supplies"),
            Map.entry("cleaning & sanitation", "supplies"),
            Map.entry("marketing", "marketing"),
            Map.entry("software", "software"),
            Map.entry("travel", "travel"),
            Map.entry("contractors", "contractors"),
            Map.entry("materials", "materials"),
            Map.entry("equipment rental", "equipment"),
            Map.entry("equipment", "equipment"),
            Map.entry("fuel", "fleet"),
            Map.entry("food & beverage", "food_beverage"),
            Map.entry("payment processing", "bank_fees"),
            Map.entry("fulfillment", "fulfillment_shipping"),
            Map.entry("shipping", "fulfillment_shipping"),
            Map.entry("meals", "other_expenses"));

    private CategoryMapper() {}

    /** A merchant's category label (free text from the bank) to a category id. */
    public static String merchant(String raw) {
        if (raw == null || raw.isBlank()) {
            return "other_expenses";
        }
        String key = raw.trim().toLowerCase(Locale.ROOT);
        String direct = MERCHANT_CATEGORY.get(key);
        if (direct != null) {
            return direct;
        }
        if (matches(key, "software|saas|subscription")) return "software";
        if (matches(key, "market|ads|advert")) return "marketing";
        if (matches(key, "travel|air|hotel|lodging")) return "travel";
        if (matches(key, "food|restaurant|grocer|beverage")) return "food_beverage";
        if (matches(key, "material|hardware|lumber|plumbing")) return "materials";
        if (matches(key, "equipment|rental")) return "equipment";
        if (matches(key, "ship|fulfil|postage|freight")) return "fulfillment_shipping";
        if (matches(key, "fuel|gas station|fleet|vehicle")) return "fleet";
        if (matches(key, "supply|supplies|packag|office")) return "supplies";
        if (matches(key, "inventory|wholesale")) return "inventory";
        if (matches(key, "contractor|labor")) return "contractors";
        if (matches(key, "insurance")) return "insurance";
        if (matches(key, "utilit|telecom|internet")) return "utilities";
        // Already a category id (the demo fixture and the ledger's own categories arrive this way).
        return SNAKE_CASE.matcher(key).matches() ? key : "other_expenses";
    }

    /** Settled money coming in. */
    public static String income(String description) {
        String d = lower(description);
        if (matches(d, "interest")) return "interest";
        if (matches(d, "retainer|invoice|milestone|progress draw|client payment|customer payment")) return "client_payment";
        if (matches(d, "settlement|payout|sales|cash deposit|deposit")) return "sales";
        return "other_income";
    }

    /** Money going out that is not a card purchase: payroll, taxes, bill payments, draws. */
    public static String withdrawal(String description) {
        String d = lower(description);
        if (d.startsWith("bill ·")) return bill(d);
        if (matches(d, "payroll")) return "payroll";
        if (matches(d, "irs|federal")) return "federal_taxes";
        if (matches(d, "sales tax")) return "sales_tax";
        if (matches(d, "\\btax")) return "state_taxes";
        if (matches(d, "owner draw|\\bdraw\\b")) return "owner_draw";
        if (matches(d, "subcontractor|contractor")) return "contractors";
        if (matches(d, "loan|installment")) return "loan_payments";
        if (matches(d, "\\bfee")) return "bank_fees";
        return "other_expenses";
    }

    /** A bill's nickname and payee to a category id. */
    public static String bill(String text) {
        String d = lower(text);
        if (matches(d, "rent|lease|office|membership|desk|suite|storage|warehouse|yard")) return "rent";
        if (matches(d, "insurance|liability|health|workers")) return "insurance";
        if (matches(d, "energy|electric|gas|utilit|internet|phone|waste|hosting|aws|telecom")) return "utilities";
        if (matches(d, "loan|credit|card payment|installment|ford")) return "loan_payments";
        if (matches(d, "payroll platform|gusto|software|workspace")) return "software";
        return "other_expenses";
    }

    /** Text after the last "·" separator, where seeded descriptions keep the counterparty. */
    public static String counterparty(String description) {
        if (description == null) {
            return null;
        }
        String[] parts = description.split("·");
        String last = parts[parts.length - 1].trim();
        return last.isEmpty() ? description.trim() : last;
    }

    /** "Invoice 1041 · Client A · net 30" names the customer in the middle segment. */
    public static String receivableCounterparty(String description) {
        if (description == null) {
            return null;
        }
        String[] parts = description.split("·");
        if (parts.length >= 2 && parts[0].trim().toLowerCase(Locale.ROOT).startsWith("invoice")) {
            String customer = parts[1].trim();
            if (!customer.isEmpty()) {
                return customer;
            }
        }
        return counterparty(description);
    }

    private static boolean matches(String text, String regex) {
        return Pattern.compile(regex).matcher(text).find();
    }

    private static String lower(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT);
    }
}
