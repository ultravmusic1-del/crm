#!/usr/bin/env bash
# Unauthenticated probe against the public REST API. No session, only the
# publishable key — which ships in the browser bundle by design.
# Every endpoint must return no data.
set -u

URL="${NEXT_PUBLIC_SUPABASE_URL:?set NEXT_PUBLIC_SUPABASE_URL}"
KEY="${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:?set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}"

fail=0

probe() {
  local path="$1" method="${2:-GET}" body="${3:-}"
  local out
  if [ "$method" = "POST" ]; then
    out=$(curl -s -X POST "$URL/rest/v1/$path" \
      -H "apikey: $KEY" -H "Content-Type: application/json" -d "$body")
  else
    out=$(curl -s "$URL/rest/v1/$path" -H "apikey: $KEY")
  fi

  if [ "$out" = "[]" ] || echo "$out" | grep -qiE '"(code|message|error)"'; then
    echo "PASS  $path"
  else
    echo "FAIL  $path  -> ${out:0:200}"
    fail=1
  fi
}

echo "── Tables ──"
for t in customers contacts interactions products customer_prices ingredients \
         product_ingredients orders order_items recurring_orders \
         recurring_order_items invoices invoice_orders payments \
         app_settings profiles signup_allowlist; do
  probe "$t?select=*&limit=1"
done

echo "── Views (the likely failure) ──"
for v in v_customer_list v_follow_ups_due v_product_costs v_effective_prices \
         v_order_totals v_order_list v_delivery_schedule v_invoice_totals \
         v_invoice_list v_uninvoiced_orders v_customer_summary; do
  probe "$v?select=*&limit=1"
done

echo "── Functions ──"
probe "rpc/f_today" POST '{}'
probe "rpc/f_bake_list" POST '{"p_from":"2000-01-01","p_to":"2100-01-01"}'
probe "rpc/f_shopping_list" POST '{"p_from":"2000-01-01","p_to":"2100-01-01"}'
probe "rpc/f_product_performance" POST '{"p_from":"2000-01-01","p_to":"2100-01-01"}'
probe "rpc/f_revenue_by_month" POST '{"p_months":12}'
probe "rpc/f_new_customers_by_month" POST '{"p_months":12}'
probe "rpc/f_outreach_effectiveness" POST '{"p_from":"2000-01-01","p_to":"2100-01-01"}'
probe "rpc/f_generate_scheduled_orders" POST '{"p_until":"2100-01-01"}'
probe "rpc/f_create_invoice" POST '{"p_customer_id":"00000000-0000-4000-8000-000000000000","p_order_ids":[],"p_issued_on":"2026-01-01","p_due_on":"2026-01-15"}'
probe "rpc/f_void_invoice" POST '{"p_invoice_id":"00000000-0000-4000-8000-000000000000"}'

echo "── Writes ──"
probe "customers" POST '{"name":"RLS probe should not exist"}'

if [ "$fail" -eq 0 ]; then
  echo "ALL RLS PROBES PASSED"
else
  echo "RLS PROBES FAILED — fix before shipping"
  exit 1
fi
