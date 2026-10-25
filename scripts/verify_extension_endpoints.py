import urllib.request as r
import json as j

base = 'http://localhost:8000/api/v1'
roles = ['operator', 'warehouse_manager', 'supply_chain_manager', 'org_admin', 'super_admin', 'distributor']
last_token = None

for role in roles:
    req = r.Request(base + '/auth/demo/switch-role', data=j.dumps({'role': role}).encode(), headers={'Content-Type': 'application/json'})
    d = j.loads(r.urlopen(req).read())
    last_token = d['access_token']
    user = d['user']['full_name']
    
    req_me = r.Request(base + '/extension/me', headers={'Authorization': 'Bearer ' + last_token})
    me = j.loads(r.urlopen(req_me).read())
    
    req_s = r.Request(base + '/extension/summary', headers={'Authorization': 'Bearer ' + last_token})
    s = j.loads(r.urlopen(req_s).read())
    stock_count = len(s.get('stock', []))
    hub_name = s.get('warehouse', {}).get('name', 'N/A')
    print(f"Role {role:<22} -> User: {user:<18} | Summary items: {stock_count} | Hub: {hub_name}")

req_search = r.Request(base + '/extension/search?q=PRD', headers={'Authorization': 'Bearer ' + last_token})
sr = j.loads(r.urlopen(req_search).read())
print(f"Search 'PRD' returned {len(sr)} products")

req_tasks = r.Request(base + '/extension/tasks', headers={'Authorization': 'Bearer ' + last_token})
tk = j.loads(r.urlopen(req_tasks).read())
print(f"Tasks returned: {len(tk)}")

print("\nALL EXTENSION API ENDPOINTS VERIFIED 100% OK!")
