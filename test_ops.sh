#!/bin/bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/ops/auth/login \
  -H "Content-Type: application/json" \
  -d @/tmp/login.json \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')

FIRST_TECH_ID=$(curl -s http://localhost:3000/api/ops/me/techs -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); techs=d.get("techs",[]); print(techs[0]["id"] if techs else "")')
echo "Tech ID: $FIRST_TECH_ID"
echo "--- Raw ticket response (first 2000 chars) ---"
curl -s "http://localhost:3000/api/ops/techs/$FIRST_TECH_ID/tickets?range=all" -H "Authorization: Bearer $TOKEN" | python3 -c '
import sys,json
d=json.load(sys.stdin)
tickets=d.get("tickets",[])
if tickets:
    t=tickets[0]
    print("Keys:", list(t.keys()))
    print("ticketNumber:", t.get("ticketNumber"))
    print("locatorStatus:", t.get("locatorStatus"))
    print("ticketType:", t.get("ticketType"))
    print("has payloadJson:", bool(t.get("payloadJson")))
    print("dueUrgency:", t.get("dueUrgency"))
else:
    print("No tickets")
'
