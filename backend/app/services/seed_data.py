from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any
from app.core.database import db
from app.core.security import get_password_hash, ROLE_SUPER_ADMIN, ROLE_ORG_ADMIN, ROLE_SUPPLY_CHAIN_MANAGER, ROLE_WAREHOUSE_MANAGER, ROLE_DISTRIBUTOR, ROLE_OPERATOR

ORG_ID = "org_triwiz_01"

def init_seed_data():
    """
    Seeds comprehensive realistic multi-warehouse enterprise dataset into data store.
    """
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    # 1. Organization
    org = {
        "id": ORG_ID,
        "name": "Acuity BioLogistics Global",
        "code": "ABLG",
        "industry": "Pharmaceuticals & Cold-Chain Distribution",
        "created_at": now_iso,
        "status": "active"
    }
    db.set_document("organizations", org["id"], org)

    # 2. Users (All 6 Roles)
    hashed_pwd = get_password_hash("Admin123!")
    users = [
        {
            "id": "usr_superadmin",
            "email": "superadmin@stockpilot.ai",
            "full_name": "Sarah Chen",
            "role": ROLE_SUPER_ADMIN,
            "org_id": ORG_ID,
            "warehouse_id": None,
            "phone_number": "+13125550101",
            "hashed_password": hashed_pwd,
            "is_active": True,
            "created_at": now_iso,
        },
        {
            "id": "usr_orgadmin",
            "email": "orgadmin@stockpilot.ai",
            "full_name": "Marcus Vance",
            "role": ROLE_ORG_ADMIN,
            "org_id": ORG_ID,
            "warehouse_id": None,
            "phone_number": "+13125550102",
            "hashed_password": hashed_pwd,
            "is_active": True,
            "created_at": now_iso,
        },
        {
            "id": "usr_supplychain",
            "email": "supplychain@stockpilot.ai",
            "full_name": "Elena Rostova",
            "role": ROLE_SUPPLY_CHAIN_MANAGER,
            "org_id": ORG_ID,
            "warehouse_id": None,
            "phone_number": "+13125550103",
            "hashed_password": hashed_pwd,
            "is_active": True,
            "created_at": now_iso,
        },
        {
            "id": "usr_whmanager",
            "email": "warehouse.manager@stockpilot.ai",
            "full_name": "David Sterling",
            "role": ROLE_WAREHOUSE_MANAGER,
            "org_id": ORG_ID,
            "warehouse_id": "wh_chicago_01",
            "phone_number": "+13125550104",
            "hashed_password": hashed_pwd,
            "is_active": True,
            "created_at": now_iso,
        },
        {
            "id": "usr_distributor",
            "email": "distributor@stockpilot.ai",
            "full_name": "Rajiv Patel",
            "role": ROLE_DISTRIBUTOR,
            "org_id": ORG_ID,
            "warehouse_id": None,
            "phone_number": "+13125550105",
            "hashed_password": hashed_pwd,
            "is_active": True,
            "created_at": now_iso,
        },
        {
            "id": "usr_operator",
            "email": "operator@stockpilot.ai",
            "full_name": "James O'Connor",
            "role": ROLE_OPERATOR,
            "org_id": ORG_ID,
            "warehouse_id": "wh_chicago_01",
            "phone_number": "+13125550106",
            "hashed_password": hashed_pwd,
            "is_active": True,
            "created_at": now_iso,
        },
    ]
    for u in users:
        db.set_document("users", u["id"], u)

    # 3. Warehouses
    warehouses = [
        {
            "id": "wh_chicago_01",
            "org_id": ORG_ID,
            "code": "WH-ORD-01",
            "name": "Central Hub Chicago",
            "address": "4500 W Logistics Pkwy",
            "city": "Chicago",
            "state": "IL",
            "lat": 41.8781,
            "lng": -87.6298,
            "capacity_pallets": 14000,
            "used_pallets": 9200,
            "cold_storage_capacity": 5000,
            "is_operational": True,
            "operating_cost_per_pallet": 1.15,
            "created_at": now_iso,
        },
        {
            "id": "wh_ny_02",
            "org_id": ORG_ID,
            "code": "WH-JFK-02",
            "name": "East DC New York",
            "address": "1200 Atlantic Cargo Way",
            "city": "Newark",
            "state": "NJ",
            "lat": 40.7128,
            "lng": -74.0060,
            "capacity_pallets": 9500,
            "used_pallets": 7400,
            "cold_storage_capacity": 3500,
            "is_operational": True,
            "operating_cost_per_pallet": 1.45,
            "created_at": now_iso,
        },
        {
            "id": "wh_dallas_03",
            "org_id": ORG_ID,
            "code": "WH-DFW-03",
            "name": "South DC Dallas",
            "address": "8800 Lone Star Freight Ave",
            "city": "Dallas",
            "state": "TX",
            "lat": 32.7767,
            "lng": -96.7970,
            "capacity_pallets": 11000,
            "used_pallets": 6800,
            "cold_storage_capacity": 3800,
            "is_operational": True,
            "operating_cost_per_pallet": 1.10,
            "created_at": now_iso,
        },
        {
            "id": "wh_reno_04",
            "org_id": ORG_ID,
            "code": "WH-RNO-04",
            "name": "West DC Reno",
            "address": "3300 Sierra Overland Blvd",
            "city": "Reno",
            "state": "NV",
            "lat": 39.5296,
            "lng": -119.8138,
            "capacity_pallets": 12500,
            "used_pallets": 7100,
            "cold_storage_capacity": 4200,
            "is_operational": True,
            "operating_cost_per_pallet": 1.25,
            "created_at": now_iso,
        },
    ]
    for wh in warehouses:
        db.set_document("warehouses", wh["id"], wh)

    # 4. Regional Destinations
    destinations = [
        {"id": "dest_boston_01", "org_id": ORG_ID, "code": "DST-BOS", "name": "Boston Medical Center", "type": "hospital", "city": "Boston, MA", "lat": 42.3601, "lng": -71.0589, "service_level_priority": 1},
        {"id": "dest_atlanta_02", "org_id": ORG_ID, "code": "DST-ATL", "name": "Atlanta Regional Clinic Network", "type": "clinic", "city": "Atlanta, GA", "lat": 33.7490, "lng": -84.3880, "service_level_priority": 2},
        {"id": "dest_detroit_03", "org_id": ORG_ID, "code": "DST-DET", "name": "Detroit Metropolitan Hospital", "type": "hospital", "city": "Detroit, MI", "lat": 42.3314, "lng": -83.0458, "service_level_priority": 1},
        {"id": "dest_denver_04", "org_id": ORG_ID, "code": "DST-DEN", "name": "Denver Health Hub", "type": "distribution_center", "city": "Denver, CO", "lat": 39.7392, "lng": -104.9903, "service_level_priority": 2},
        {"id": "dest_phoenix_05", "org_id": ORG_ID, "code": "DST-PHX", "name": "Phoenix Southwest Medical", "type": "hospital", "city": "Phoenix, AZ", "lat": 33.4484, "lng": -112.0740, "service_level_priority": 2},
        {"id": "dest_seattle_06", "org_id": ORG_ID, "code": "DST-SEA", "name": "Seattle Clinical Care Center", "type": "clinic", "city": "Seattle, WA", "lat": 47.6062, "lng": -122.3321, "service_level_priority": 1},
        {"id": "dest_minn_07", "org_id": ORG_ID, "code": "DST-MSP", "name": "Minneapolis Health Center", "type": "clinic", "city": "Minneapolis, MN", "lat": 44.9778, "lng": -93.2650, "service_level_priority": 3},
        {"id": "dest_houston_08", "org_id": ORG_ID, "code": "DST-HOU", "name": "Houston Apex Pharmacy DC", "type": "distribution_center", "city": "Houston, TX", "lat": 29.7604, "lng": -95.3698, "service_level_priority": 2},
    ]
    for d in destinations:
        db.set_document("destinations", d["id"], d)

    # 5. Products
    products = [
        {
            "id": "prd_vax_01",
            "org_id": ORG_ID,
            "sku": "PRD-VAX-01",
            "name": "Comirnaty Ultra-Cold Vaccine",
            "category": "Vaccines & Biologics",
            "description": "Multi-dose vial ultra-cold messenger RNA vaccine",
            "unit": "vials",
            "unit_cost": 22.50,
            "selling_price": 45.00,
            "handling": "cold_chain",
            "min_safety_stock": 200,
            "reorder_point": 500,
            "barcode": "8901234567891",
            "qr_code_payload": "STOCKPILOT://SKU/PRD-VAX-01/ORG/org_triwiz_01",
            "shelf_life_days": 180,
            "weight_kg": 0.25,
            "created_at": now_iso,
        },
        {
            "id": "prd_ins_02",
            "org_id": ORG_ID,
            "sku": "PRD-INS-02",
            "name": "Humalog Rapid-Acting Insulin",
            "category": "Endocrinology",
            "description": "Prefilled insulin delivery pens 100 U/mL",
            "unit": "pens",
            "unit_cost": 16.50,
            "selling_price": 38.00,
            "handling": "cold_chain",
            "min_safety_stock": 350,
            "reorder_point": 800,
            "barcode": "8901234567892",
            "qr_code_payload": "STOCKPILOT://SKU/PRD-INS-02/ORG/org_triwiz_01",
            "shelf_life_days": 240,
            "weight_kg": 0.15,
            "created_at": now_iso,
        },
        {
            "id": "prd_ant_03",
            "org_id": ORG_ID,
            "sku": "PRD-ANT-03",
            "name": "Amoxicillin 500mg Capsules",
            "category": "Antibiotics",
            "description": "Oral broad-spectrum penicillin antibiotic 100s bottle",
            "unit": "bottles",
            "unit_cost": 4.50,
            "selling_price": 12.00,
            "handling": "ambient",
            "min_safety_stock": 500,
            "reorder_point": 1200,
            "barcode": "8901234567893",
            "qr_code_payload": "STOCKPILOT://SKU/PRD-ANT-03/ORG/org_triwiz_01",
            "shelf_life_days": 730,
            "weight_kg": 0.40,
            "created_at": now_iso,
        },
        {
            "id": "prd_bio_04",
            "org_id": ORG_ID,
            "sku": "PRD-BIO-04",
            "name": "Keytruda Oncology Infusion",
            "category": "Oncology",
            "description": "High-value monoclonal antibody 100mg/4mL single vial",
            "unit": "vials",
            "unit_cost": 480.00,
            "selling_price": 950.00,
            "handling": "cold_chain",
            "min_safety_stock": 40,
            "reorder_point": 100,
            "barcode": "8901234567894",
            "qr_code_payload": "STOCKPILOT://SKU/PRD-BIO-04/ORG/org_triwiz_01",
            "shelf_life_days": 365,
            "weight_kg": 0.30,
            "created_at": now_iso,
        },
        {
            "id": "prd_ppe_05",
            "org_id": ORG_ID,
            "sku": "PRD-PPE-05",
            "name": "Sterile Nitrile Surgical Gloves (L)",
            "category": "Medical Supplies",
            "description": "Powder-free surgical examination grade 50 pairs/box",
            "unit": "boxes",
            "unit_cost": 6.80,
            "selling_price": 15.50,
            "handling": "ambient",
            "min_safety_stock": 400,
            "reorder_point": 1000,
            "barcode": "8901234567895",
            "qr_code_payload": "STOCKPILOT://SKU/PRD-PPE-05/ORG/org_triwiz_01",
            "shelf_life_days": 1095,
            "weight_kg": 0.85,
            "created_at": now_iso,
        },
        {
            "id": "prd_car_06",
            "org_id": ORG_ID,
            "sku": "PRD-CAR-06",
            "name": "Atorvastatin 20mg Cardiovascular",
            "category": "Cardiovascular",
            "description": "Statin cholesterol management 90-tablet blister packs",
            "unit": "packs",
            "unit_cost": 5.20,
            "selling_price": 14.00,
            "handling": "ambient",
            "min_safety_stock": 300,
            "reorder_point": 700,
            "barcode": "8901234567896",
            "qr_code_payload": "STOCKPILOT://SKU/PRD-CAR-06/ORG/org_triwiz_01",
            "shelf_life_days": 720,
            "weight_kg": 0.20,
            "created_at": now_iso,
        },
    ]
    for p in products:
        db.set_document("products", p["id"], p)

    # 6. Batches and Inventory
    # Setting batches with varying expiry dates to test FEFO and Near-Expiry warnings!
    batches_data = [
        # Vaccine Batches
        {
            "id": "bat_vax_chi_01",
            "warehouse_id": "wh_chicago_01",
            "product_id": "prd_vax_01",
            "batch_number": "BN-VX-2026-A1",
            "supplier_reference": "Pfizer-BioNTech-GmbH",
            "mfg_date": (now - timedelta(days=90)).strftime("%Y-%m-%d"),
            "expiry_date": (now + timedelta(days=22)).strftime("%Y-%m-%d"),  # Near Expiry! (FEFO critical)
            "quantity": 850,
            "reserved_quantity": 50,
            "damaged_quantity": 0,
            "unit_cost": 22.50,
            "storage_bin": "CR-1-A04",
        },
        {
            "id": "bat_vax_chi_02",
            "warehouse_id": "wh_chicago_01",
            "product_id": "prd_vax_01",
            "batch_number": "BN-VX-2026-B4",
            "supplier_reference": "Pfizer-BioNTech-GmbH",
            "mfg_date": (now - timedelta(days=20)).strftime("%Y-%m-%d"),
            "expiry_date": (now + timedelta(days=160)).strftime("%Y-%m-%d"),
            "quantity": 1400,
            "reserved_quantity": 0,
            "damaged_quantity": 0,
            "unit_cost": 22.50,
            "storage_bin": "CR-1-B12",
        },
        {
            "id": "bat_vax_ny_01",
            "warehouse_id": "wh_ny_02",
            "product_id": "prd_vax_01",
            "batch_number": "BN-VX-2026-N2",
            "supplier_reference": "Pfizer-BioNTech-GmbH",
            "mfg_date": (now - timedelta(days=45)).strftime("%Y-%m-%d"),
            "expiry_date": (now + timedelta(days=135)).strftime("%Y-%m-%d"),
            "quantity": 900,
            "reserved_quantity": 100,
            "damaged_quantity": 0,
            "unit_cost": 22.50,
            "storage_bin": "CR-2-C01",
        },
        {
            "id": "bat_vax_dal_01",
            "warehouse_id": "wh_dallas_03",
            "product_id": "prd_vax_01",
            "batch_number": "BN-VX-2026-D8",
            "supplier_reference": "Pfizer-BioNTech-GmbH",
            "mfg_date": (now - timedelta(days=30)).strftime("%Y-%m-%d"),
            "expiry_date": (now + timedelta(days=150)).strftime("%Y-%m-%d"),
            "quantity": 1100,
            "reserved_quantity": 0,
            "damaged_quantity": 0,
            "unit_cost": 22.50,
            "storage_bin": "CR-TX-04",
        },
        {
            "id": "bat_vax_rno_01",
            "warehouse_id": "wh_reno_04",
            "product_id": "prd_vax_01",
            "batch_number": "BN-VX-2026-R1",
            "supplier_reference": "Pfizer-BioNTech-GmbH",
            "mfg_date": (now - timedelta(days=60)).strftime("%Y-%m-%d"),
            "expiry_date": (now + timedelta(days=120)).strftime("%Y-%m-%d"),
            "quantity": 1250,
            "reserved_quantity": 0,
            "damaged_quantity": 0,
            "unit_cost": 22.50,
            "storage_bin": "CR-NV-02",
        },
        # Insulin Batches
        {
            "id": "bat_ins_chi_01",
            "warehouse_id": "wh_chicago_01",
            "product_id": "prd_ins_02",
            "batch_number": "BN-IN-2026-C3",
            "supplier_reference": "Eli Lilly & Co",
            "mfg_date": (now - timedelta(days=40)).strftime("%Y-%m-%d"),
            "expiry_date": (now + timedelta(days=200)).strftime("%Y-%m-%d"),
            "quantity": 2200,
            "reserved_quantity": 150,
            "damaged_quantity": 0,
            "unit_cost": 16.50,
            "storage_bin": "CR-1-D08",
        },
        {
            "id": "bat_ins_ny_01",
            "warehouse_id": "wh_ny_02",
            "product_id": "prd_ins_02",
            "batch_number": "BN-IN-2026-N1",
            "supplier_reference": "Eli Lilly & Co",
            "mfg_date": (now - timedelta(days=90)).strftime("%Y-%m-%d"),
            "expiry_date": (now + timedelta(days=18)).strftime("%Y-%m-%d"), # Near Expiry!
            "quantity": 650,
            "reserved_quantity": 0,
            "damaged_quantity": 0,
            "unit_cost": 16.50,
            "storage_bin": "CR-2-A02",
        },
        {
            "id": "bat_ins_dal_01",
            "warehouse_id": "wh_dallas_03",
            "product_id": "prd_ins_02",
            "batch_number": "BN-IN-2026-D4",
            "supplier_reference": "Eli Lilly & Co",
            "mfg_date": (now - timedelta(days=15)).strftime("%Y-%m-%d"),
            "expiry_date": (now + timedelta(days=225)).strftime("%Y-%m-%d"),
            "quantity": 1800,
            "reserved_quantity": 0,
            "damaged_quantity": 0,
            "unit_cost": 16.50,
            "storage_bin": "CR-TX-08",
        },
        # Oncology Keytruda Batches
        {
            "id": "bat_bio_chi_01",
            "warehouse_id": "wh_chicago_01",
            "product_id": "prd_bio_04",
            "batch_number": "BN-KT-901-CHI",
            "supplier_reference": "Merck Sharp & Dohme",
            "mfg_date": (now - timedelta(days=30)).strftime("%Y-%m-%d"),
            "expiry_date": (now + timedelta(days=335)).strftime("%Y-%m-%d"),
            "quantity": 180,
            "reserved_quantity": 10,
            "damaged_quantity": 0,
            "unit_cost": 480.00,
            "storage_bin": "VAULT-CR-01",
        },
        {
            "id": "bat_bio_ny_01",
            "warehouse_id": "wh_ny_02",
            "product_id": "prd_bio_04",
            "batch_number": "BN-KT-902-NY",
            "supplier_reference": "Merck Sharp & Dohme",
            "mfg_date": (now - timedelta(days=25)).strftime("%Y-%m-%d"),
            "expiry_date": (now + timedelta(days=340)).strftime("%Y-%m-%d"),
            "quantity": 140,
            "reserved_quantity": 0,
            "damaged_quantity": 0,
            "unit_cost": 480.00,
            "storage_bin": "VAULT-CR-02",
        },
        # Ambient Antibiotics
        {
            "id": "bat_ant_chi_01",
            "warehouse_id": "wh_chicago_01",
            "product_id": "prd_ant_03",
            "batch_number": "BN-AM-701-C",
            "supplier_reference": "Teva Pharmaceuticals",
            "mfg_date": (now - timedelta(days=120)).strftime("%Y-%m-%d"),
            "expiry_date": (now + timedelta(days=610)).strftime("%Y-%m-%d"),
            "quantity": 4200,
            "reserved_quantity": 200,
            "damaged_quantity": 0,
            "unit_cost": 4.50,
            "storage_bin": "AMB-BAY-14",
        },
        {
            "id": "bat_ant_dal_01",
            "warehouse_id": "wh_dallas_03",
            "product_id": "prd_ant_03",
            "batch_number": "BN-AM-702-D",
            "supplier_reference": "Teva Pharmaceuticals",
            "mfg_date": (now - timedelta(days=100)).strftime("%Y-%m-%d"),
            "expiry_date": (now + timedelta(days=630)).strftime("%Y-%m-%d"),
            "quantity": 3800,
            "reserved_quantity": 0,
            "damaged_quantity": 0,
            "unit_cost": 4.50,
            "storage_bin": "AMB-BAY-03",
        },
        # PPE & Cardiovascular
        {
            "id": "bat_ppe_chi_01",
            "warehouse_id": "wh_chicago_01",
            "product_id": "prd_ppe_05",
            "batch_number": "BN-GL-301",
            "supplier_reference": "Ansell Healthcare",
            "mfg_date": (now - timedelta(days=150)).strftime("%Y-%m-%d"),
            "expiry_date": (now + timedelta(days=945)).strftime("%Y-%m-%d"),
            "quantity": 5600,
            "reserved_quantity": 300,
            "damaged_quantity": 0,
            "unit_cost": 6.80,
            "storage_bin": "PALLET-RACK-07",
        },
        {
            "id": "bat_car_chi_01",
            "warehouse_id": "wh_chicago_01",
            "product_id": "prd_car_06",
            "batch_number": "BN-AT-401",
            "supplier_reference": "Viatris Inc",
            "mfg_date": (now - timedelta(days=80)).strftime("%Y-%m-%d"),
            "expiry_date": (now + timedelta(days=640)).strftime("%Y-%m-%d"),
            "quantity": 3100,
            "reserved_quantity": 100,
            "damaged_quantity": 0,
            "unit_cost": 5.20,
            "storage_bin": "AMB-BAY-08",
        },
    ]

    for b in batches_data:
        b_doc = {
            **b,
            "org_id": ORG_ID,
            "qr_code_id": f"STOCKPILOT://BATCH/{b['batch_number']}/WH/{b['warehouse_id']}",
            "status": "active",
            "created_at": now_iso
        }
        db.set_document("inventory_batches", b["id"], b_doc)

    # 7. Aggregate Inventory by Warehouse & Product
    inventory_items = {}
    for b in batches_data:
        key = f"{b['warehouse_id']}_{b['product_id']}"
        if key not in inventory_items:
            inventory_items[key] = {
                "id": f"inv_{key}",
                "org_id": ORG_ID,
                "warehouse_id": b["warehouse_id"],
                "product_id": b["product_id"],
                "total_quantity": 0,
                "reserved_quantity": 0,
                "available_quantity": 0,
                "damaged_quantity": 0,
                "in_transit_quantity": 0,
                "safety_stock": 250,
                "reorder_point": 500,
                "updated_at": now_iso,
            }
        inventory_items[key]["total_quantity"] += b["quantity"]
        inventory_items[key]["reserved_quantity"] += b["reserved_quantity"]
        inventory_items[key]["damaged_quantity"] += b["damaged_quantity"]
        inventory_items[key]["available_quantity"] += (b["quantity"] - b["reserved_quantity"] - b["damaged_quantity"])

    for inv in inventory_items.values():
        db.set_document("inventory", inv["id"], inv)

    # 8. Initial Movements Ledger
    initial_movements = [
        {
            "id": "mov_init_01",
            "org_id": ORG_ID,
            "correlation_id": "INIT-RECEIPT-2026-001",
            "product_id": "prd_vax_01",
            "batch_id": "bat_vax_chi_01",
            "source_warehouse_id": None,
            "destination_id": "wh_chicago_01",
            "movement_type": "receipt",
            "quantity_changed": 850,
            "balance_after": 850,
            "actor_id": "usr_operator",
            "actor_name": "James O'Connor",
            "reason": "Initial supplier stock receipt from Pfizer-BioNTech",
            "timestamp": (now - timedelta(days=5)).isoformat(),
        },
        {
            "id": "mov_init_02",
            "org_id": ORG_ID,
            "correlation_id": "INIT-RECEIPT-2026-002",
            "product_id": "prd_ins_02",
            "batch_id": "bat_ins_chi_01",
            "source_warehouse_id": None,
            "destination_id": "wh_chicago_01",
            "movement_type": "receipt",
            "quantity_changed": 2200,
            "balance_after": 2200,
            "actor_id": "usr_operator",
            "actor_name": "James O'Connor",
            "reason": "Initial supplier shipment receipt from Eli Lilly",
            "timestamp": (now - timedelta(days=3)).isoformat(),
        },
    ]
    for m in initial_movements:
        db.set_document("inventory_movements", m["id"], m)

    # 9. IoT Devices & Telemetry
    devices = [
        {
            "device_id": "ESP32-COLD-CHI-01",
            "org_id": ORG_ID,
            "warehouse_id": "wh_chicago_01",
            "storage_zone": "Cold Room A (Vaccines & Insulin)",
            "device_name": "ESP32 Cold Sentinel A1",
            "mac_address": "24:6F:28:AB:12:01",
            "ip_address": "192.168.10.45",
            "last_ping": now_iso,
            "is_online": True,
            "firmware_version": "v2.5.0-esp32-secure",
            "temp_min_threshold": 2.0,
            "temp_max_threshold": 8.0,
            "humidity_max_threshold": 60.0,
            "current_temp": 4.2,
            "current_humidity": 48.5,
        },
        {
            "device_id": "ESP32-DEEP-CHI-02",
            "org_id": ORG_ID,
            "warehouse_id": "wh_chicago_01",
            "storage_zone": "Ultra-Low Freezer Vault (-20C to -80C)",
            "device_name": "ESP32 Cryo Sentinel B2",
            "mac_address": "24:6F:28:AB:12:02",
            "ip_address": "192.168.10.46",
            "last_ping": now_iso,
            "is_online": True,
            "firmware_version": "v2.5.0-esp32-secure",
            "temp_min_threshold": -80.0,
            "temp_max_threshold": -20.0,
            "humidity_max_threshold": 30.0,
            "current_temp": -22.4,
            "current_humidity": 18.2,
        },
        {
            "device_id": "ESP32-AMB-NY-03",
            "org_id": ORG_ID,
            "warehouse_id": "wh_ny_02",
            "storage_zone": "Main Pharmaceutical Aisle 4",
            "device_name": "ESP32 Ambient Sentinel C3",
            "mac_address": "24:6F:28:AB:14:19",
            "ip_address": "192.168.20.12",
            "last_ping": now_iso,
            "is_online": True,
            "firmware_version": "v2.5.0-esp32-secure",
            "temp_min_threshold": 15.0,
            "temp_max_threshold": 25.0,
            "humidity_max_threshold": 65.0,
            "current_temp": 21.0,
            "current_humidity": 52.0,
        },
    ]
    for dev in devices:
        db.set_document("iot_devices", dev["device_id"], dev)

    # Historical Telemetry readings (last 24 hours in 1-hour intervals)
    for dev in devices:
        base_temp = dev["current_temp"]
        base_hum = dev["current_humidity"]
        for h in range(24, 0, -1):
            ts = (now - timedelta(hours=h)).isoformat()
            reading_id = f"read_{dev['device_id']}_{h}"
            import math
            temp_variation = round(base_temp + 0.4 * math.sin(h / 3.0), 2)
            hum_variation = round(base_hum + 1.2 * math.cos(h / 2.5), 1)
            reading = {
                "id": reading_id,
                "device_id": dev["device_id"],
                "org_id": ORG_ID,
                "warehouse_id": dev["warehouse_id"],
                "storage_zone": dev["storage_zone"],
                "timestamp": ts,
                "temperature_c": temp_variation,
                "humidity_percent": hum_variation,
                "battery_level_percent": 98.0,
                "door_open": False,
                "is_valid": True,
            }
            db.set_document("sensor_readings", reading_id, reading)

    # 10. Sample Pending Inter-Warehouse Transfer
    transfer_sample = {
        "id": "trf_001_chi_ny",
        "org_id": ORG_ID,
        "transfer_number": "TRF-2026-0891",
        "source_warehouse_id": "wh_chicago_01",
        "target_warehouse_id": "wh_ny_02",
        "items": [
            {"product_id": "prd_vax_01", "batch_id": "bat_vax_chi_02", "quantity": 300, "unit_cost": 22.50},
            {"product_id": "prd_bio_04", "batch_id": "bat_bio_chi_01", "quantity": 25, "unit_cost": 480.00},
        ],
        "status": "pending",
        "requested_by_id": "usr_supplychain",
        "requested_by_name": "Elena Rostova",
        "approved_by_id": None,
        "approved_by_name": None,
        "estimated_transport_cost": 340.50,
        "notes": "Urgent replenishment for East Coast hospital network demand surge",
        "created_at": (now - timedelta(hours=4)).isoformat(),
        "updated_at": (now - timedelta(hours=4)).isoformat(),
    }
    db.set_document("transfers", transfer_sample["id"], transfer_sample)

    # 11. Initial Audit Logs
    audit_init = {
        "id": "aud_init_001",
        "org_id": ORG_ID,
        "actor_id": "usr_superadmin",
        "actor_name": "Sarah Chen",
        "actor_role": ROLE_SUPER_ADMIN,
        "action": "SYSTEM_INITIALIZE",
        "target_entity": "organization",
        "entity_id": ORG_ID,
        "details": {"message": "StockPilot AI enterprise cluster initialized successfully"},
        "ip_address": "127.0.0.1",
        "timestamp": now_iso,
    }
    db.set_document("audit_logs", audit_init["id"], audit_init)

    print(f"[SUCCESS] STOCKPILOT AI Seed Data successfully initialized for organization {ORG_ID}")
