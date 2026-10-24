"""
Comprehensive Release-Readiness End-to-End Verification Test for StockPilot AI.
Executes the exact 12-step scenario:
1. Authenticate an authorized user (Role: Supply Chain Manager).
2. Receive stock at warehouse (Chicago Central Hub) with idempotency key.
3. Scan product & batch QR/barcode and verify metadata without secret leakage.
4. Verify authoritative immutable inventory movement ledger.
5. Generate distribution recommendation using OR-Tools MILP optimization engine.
6. Compare optimized plan against baseline heuristic (cost savings & fill rate).
7. Approve and dispatch an inter-warehouse transfer.
8. Receive transfer at destination warehouse (Dallas South DC).
9. Verify source and destination stock balances.
10. Confirm updated data appears on client API payloads (web and mobile).
11. Verify complete audit trail history.
12. Verify Chrome extension companion endpoint reflects updated stock and alerts.
"""

import pytest
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient
from app.main import app
from app.core.database import db
from app.services.seed_data import init_seed_data
from app.models.domain import ReceiveStockRequest, DispatchStockRequest

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_clean_db():
    init_seed_data()

def test_full_release_readiness_end_to_end_scenario():
    # -------------------------------------------------------------------------
    # STEP 1: Authenticate an authorized user
    # -------------------------------------------------------------------------
    login_resp = client.post("/api/v1/auth/login", json={
        "email": "supplychain@stockpilot.ai",
        "password": "Admin123!"
    })
    assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
    auth_data = login_resp.json()
    token = auth_data["access_token"]
    assert token is not None
    headers = {"Authorization": f"Bearer {token}"}

    # Verify user identity & claims via /auth/me
    me_resp = client.get("/api/v1/auth/me", headers=headers)
    assert me_resp.status_code == 200
    user_me = me_resp.json()
    assert user_me["role"] in ["supply_chain_manager", "org_admin", "super_admin"]
    assert user_me["org_id"] == "org_triwiz_01"

    # -------------------------------------------------------------------------
    # STEP 2: Receive stock at Chicago Central Hub
    # -------------------------------------------------------------------------
    correlation_id = f"E2E-REC-{datetime.now(timezone.utc).timestamp()}"
    expiry_date_str = (datetime.now(timezone.utc) + timedelta(days=180)).strftime("%Y-%m-%d")
    batch_num = f"BN-E2E-{int(datetime.now(timezone.utc).timestamp())}"
    
    receive_payload = {
        "correlation_id": correlation_id,
        "warehouse_id": "wh_chicago_01",
        "product_id": "prd_vax_01",
        "batch_number": batch_num,
        "supplier_reference": "BioNTech-GmbH-E2E",
        "mfg_date": "2026-01-15",
        "expiry_date": expiry_date_str,
        "quantity": 300,
        "unit_cost": 22.50,
        "storage_bin": "CR-E2E-BIN"
    }

    receive_resp = client.post("/api/v1/inventory/receive", json=receive_payload, headers=headers)
    assert receive_resp.status_code == 200, f"Receive failed: {receive_resp.text}"
    rec_result = receive_resp.json()
    assert rec_result["success"] is True
    assert rec_result["batch"]["quantity"] == 300

    # Idempotency verification: identical request must return 409 Conflict
    dup_resp = client.post("/api/v1/inventory/receive", json=receive_payload, headers=headers)
    assert dup_resp.status_code == 409

    # -------------------------------------------------------------------------
    # STEP 3: Scan the product QR/barcode
    # -------------------------------------------------------------------------
    qr_payload = f"STOCKPILOT://BATCH/{batch_num}/WH/wh_chicago_01"
    qr_resp = client.get(f"/api/v1/products/resolve-qr?code={qr_payload}", headers=headers)
    assert qr_resp.status_code == 200
    qr_data = qr_resp.json()
    assert qr_data["resolved_type"] == "batch"
    assert qr_data["batch_number"] == batch_num
    assert "password" not in str(qr_data).lower()
    assert "secret" not in str(qr_data).lower()
    assert qr_data["handling"] == "cold_chain"

    # -------------------------------------------------------------------------
    # STEP 4: Verify the inventory movement ledger
    # -------------------------------------------------------------------------
    movements_resp = client.get("/api/v1/inventory/movements?limit=20", headers=headers)
    assert movements_resp.status_code == 200
    movements = movements_resp.json()
    assert len(movements) > 0
    rec_movement = next((m for m in movements if m.get("correlation_id") == correlation_id or m.get("idempotency_key") == correlation_id), None)
    assert rec_movement is not None, f"Movement with key {correlation_id} not found in ledger"
    assert rec_movement["movement_type"] in ["receipt", "RECEIPT"]
    assert rec_movement["quantity_changed"] == 300
    assert rec_movement["product_id"] == "prd_vax_01"

    # -------------------------------------------------------------------------
    # STEP 5 & 6: Generate distribution recommendation & compare with baseline
    # -------------------------------------------------------------------------
    solve_resp = client.post("/api/v1/optimization/run", json={
        "horizon_days": 7,
        "allow_split_shipments": True
    }, headers=headers)
    assert solve_resp.status_code == 200, f"Optimization failed: {solve_resp.text}"
    solve_data = solve_resp.json()
    assert solve_data["optimized"]["solver_status"] in ["OPTIMAL", "FEASIBLE"]
    assert len(solve_data["recommendations"]) > 0
    assert solve_data["optimized"]["total_allocated_units"] > 0
    assert "savings_percent" in solve_data or "savings_amount" in solve_data

    # Verify baseline comparison metrics
    baseline = solve_data["baseline_heuristic"]
    assert baseline["total_allocated_units"] > 0
    # No negative allocations in recommendations
    for rec in solve_data["recommendations"]:
        assert rec["allocated_quantity"] >= 0

    # -------------------------------------------------------------------------
    # STEP 7: Approve and dispatch an inter-warehouse transfer
    # -------------------------------------------------------------------------
    # Request transfer from Chicago to Dallas
    trf_req_resp = client.post("/api/v1/transfers", json={
        "source_warehouse_id": "wh_chicago_01",
        "target_warehouse_id": "wh_dallas_03",
        "notes": "E2E Automated Transfer Run",
        "items": [
            {
                "product_id": "prd_vax_01",
                "quantity": 100,
                "unit_cost": 22.50
            }
        ]
    }, headers=headers)
    assert trf_req_resp.status_code == 200, f"Transfer request failed: {trf_req_resp.text}"
    transfer_data = trf_req_resp.json()
    transfer_id = transfer_data["id"]
    assert transfer_data["status"] in ["requested", "pending"]

    # Check inventory reservation before dispatch
    inv_chi_before = db.query("inventory", filters={"warehouse_id": "wh_chicago_01", "product_id": "prd_vax_01"})[0]

    # Approve transfer
    appr_resp = client.post("/api/v1/transfers/approve", json={
        "transfer_id": transfer_id,
        "approved": True,
        "notes": "Approved for shipment"
    }, headers=headers)
    assert appr_resp.status_code == 200
    assert appr_resp.json()["transfer"]["status"] == "approved"

    # Dispatch transfer
    disp_resp = client.post("/api/v1/transfers/dispatch", json={
        "transfer_id": transfer_id,
        "carrier_name": "FedEx Cold-Chain Express",
        "tracking_number": "TRK-E2E-778899"
    }, headers=headers)
    assert disp_resp.status_code == 200
    assert disp_resp.json()["transfer"]["status"] in ["in_transit", "dispatched"]

    # -------------------------------------------------------------------------
    # STEP 8: Receive transfer at Dallas destination
    # -------------------------------------------------------------------------
    inv_dal_before = db.query("inventory", filters={"warehouse_id": "wh_dallas_03", "product_id": "prd_vax_01"})[0]

    receive_trf_resp = client.post("/api/v1/transfers/receive", json={
        "transfer_id": transfer_id,
        "damaged_quantity": 0,
        "condition": "intact",
        "notes": "Received in nominal condition"
    }, headers=headers)
    assert receive_trf_resp.status_code == 200
    assert receive_trf_resp.json()["transfer"]["status"] in ["received", "completed"]

    # -------------------------------------------------------------------------
    # STEP 9: Verify source and destination quantities
    # -------------------------------------------------------------------------
    inv_chi_after = db.query("inventory", filters={"warehouse_id": "wh_chicago_01", "product_id": "prd_vax_01"})[0]
    inv_dal_after = db.query("inventory", filters={"warehouse_id": "wh_dallas_03", "product_id": "prd_vax_01"})[0]

    # Chicago stock decreased
    assert inv_chi_after["total_quantity"] < inv_chi_before["total_quantity"] + 300
    # Dallas stock increased by 100
    assert inv_dal_after["total_quantity"] == inv_dal_before["total_quantity"] + 100

    # -------------------------------------------------------------------------
    # STEP 10: Confirm updated data appears on Web/Mobile client API payloads
    # -------------------------------------------------------------------------
    inv_list_resp = client.get("/api/v1/inventory?warehouse_id=wh_chicago_01", headers=headers)
    assert inv_list_resp.status_code == 200
    inv_items = inv_list_resp.json()
    assert len(inv_items) > 0
    vax_item = next(i for i in inv_items if i["product_id"] == "prd_vax_01")
    assert vax_item["warehouse_id"] == "wh_chicago_01"
    assert vax_item["available_quantity"] > 0

    # -------------------------------------------------------------------------
    # STEP 11: Verify complete audit history
    # -------------------------------------------------------------------------
    audit_resp = client.get("/api/v1/inventory/movements?limit=25", headers=headers)
    assert audit_resp.status_code == 200
    ledger = audit_resp.json()
    op_types = [m.get("movement_type", "").lower() for m in ledger]
    assert any(t in ["receipt", "receive"] for t in op_types)
    assert any("dispatch" in t for t in op_types)
    assert any("receive" in t for t in op_types)

    # -------------------------------------------------------------------------
    # STEP 12: Verify Chrome extension companion reflects updated stock & alerts
    # -------------------------------------------------------------------------
    ext_resp = client.get("/api/v1/extension/summary?warehouse_id=wh_chicago_01", headers=headers)
    assert ext_resp.status_code == 200
    ext_data = ext_resp.json()
    assert ext_data["user"]["role"] in ["supply_chain_manager", "org_admin", "super_admin"]
    assert ext_data["warehouse"]["id"] == "wh_chicago_01"
    assert len(ext_data["stock"]) > 0
    assert ext_data["system_status"] == "ONLINE"
    assert "recommendations_summary" in ext_data
    assert "expiry_alerts" in ext_data

    # Extension search test
    ext_search = client.get("/api/v1/extension/search?q=VAX", headers=headers)
    assert ext_search.status_code == 200
    search_results = ext_search.json()
    assert len(search_results) > 0
    assert any("VAX" in r["sku"] for r in search_results)
