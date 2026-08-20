#!/bin/bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/ops/auth/login \
  -H "Content-Type: application/json" \
  -d @/tmp/login.json \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')

echo "--- Needs attention with customers ---"
curl -s http://localhost:3000/api/ops/me/overview -H "Authorization: Bearer $TOKEN" | python3 -c '
import sys,json
d=json.load(sys.stdin)
na=d.get("needsAttention",[])
print(f"needs attention count: {len(na)}")
for item in na[:2]:
    print(f"  type={item["type"]} label={item["label"]} customers={len(item.get("customers",[]))}")
    for c in item.get("customers",[])[:3]:
        print(f"    {c["id"][:8]} utility={c["utility"]}")
'

echo ""
echo "--- Ticket detail with customers ---"
FIRST_TICKET_ID=$(curl -s http://localhost:3000/api/ops/me/overview -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); na=d.get("needsAttention",[]); print(na[0]["id"] if na else "")')
echo "Ticket ID: $FIRST_TICKET_ID"
curl -s "http://localhost:3000/api/ops/tickets/$FIRST_TICKET_ID" -H "Authorization: Bearer $TOKEN" | python3 -c '
import sys,json
d=json.load(sys.stdin)
customers=d.get("customers",[])
print(f"customers count: {len(customers)}")
for c in customers[:3]:
    print(f"  {c.get("customerName","?")} utility={c.get("utilityType","?")} status={c.get("status","")} completed={c.get("completed",False)}")
'
