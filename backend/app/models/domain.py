from datetime import datetime, timezone
from enum import Enum
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

# -------------------------------------------------------------
# Auth & User Models
# -------------------------------------------------------------
class RoleEnum(str, Enum):
    SUPER_ADMIN = "super_admin"
    ORG_ADMIN = "org_admin"
    SUPPLY_CHAIN_MANAGER = "supply_chain_manager"
    WAREHOUSE_MANAGER = "warehouse_manager"
    DISTRIBUTOR = "distributor"
    OPERATOR = "operator"
    WAREHOUSE_OPERATOR = "warehouse_operator"
    DISTRIBUTOR_FIELD_OPERATOR = "distributor_field_operator"

class UserBase(BaseModel):
    email: str
    full_name: str
    role: RoleEnum
    org_id: str
    warehouse_id: Optional[str] = None
    warehouse_ids: Optional[List[str]] = None
    permissions: Optional[List[str]] = None
    phone_number: Optional[str] = None
    is_active: bool = True

class UserCreate(UserBase):
    password: str

class UserInvite(BaseModel):
    email: str
    full_name: str
    role: RoleEnum
    warehouse_id: Optional[str] = None
    warehouse_ids: Optional[List[str]] = None
    permissions: Optional[List[str]] = None
    temporary_password: Optional[str] = "StockPilot2026!"

class UserUpdateRequest(BaseModel):
    full_name: Optional[str] = None
    role: Optional[RoleEnum] = None
    warehouse_id: Optional[str] = None
    warehouse_ids: Optional[List[str]] = None
    permissions: Optional[List[str]] = None
    is_active: Optional[bool] = None

class UserLogin(BaseModel):
    email: str
    password: str

class UserResponse(UserBase):
    id: str
    created_at: str
    updated_at: str

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse

# -------------------------------------------------------------
# Warehouse & Destination Models
# -------------------------------------------------------------
class Warehouse(BaseModel):
    id: str
    org_id: str
    code: str
    name: str
    address: str
    city: str
    state: str
    lat: float
    lng: float
    capacity_pallets: int
    used_pallets: int = 0
    cold_storage_capacity: int = 0
    is_operational: bool = True
    operating_cost_per_pallet: float = 1.20
    created_at: Optional[str] = None

class Destination(BaseModel):
    id: str
    org_id: str
    code: str
    name: str
    type: str  # "clinic", "hospital", "retail_store", "distribution_center"
    city: str
    lat: float
    lng: float
    service_level_priority: int = 1  # 1 (Critical) to 5 (Standard)
    created_at: Optional[str] = None

# -------------------------------------------------------------
# Product & Category Models
# -------------------------------------------------------------
class HandlingRequirement(str, Enum):
    COLD_CHAIN = "cold_chain"      # 2C - 8C
    DEEP_FREEZE = "deep_freeze"    # -20C
    AMBIENT = "ambient"            # 15C - 25C
    HAZARDOUS = "hazardous"
    FRAGILE = "fragile"

class Product(BaseModel):
    id: str
    org_id: str
    sku: str
    name: str
    category: str
    description: Optional[str] = ""
    unit: str = "units"  # "units", "vials", "boxes", "pallets"
    unit_cost: float = 0.0
    selling_price: float = 0.0
    handling: HandlingRequirement = HandlingRequirement.AMBIENT
    min_safety_stock: int = 50
    reorder_point: int = 100
    barcode: str = ""
    qr_code_payload: str = ""
    shelf_life_days: int = 365
    weight_kg: float = 0.5
    created_at: Optional[str] = None

# -------------------------------------------------------------
# Inventory & Batch Models
# -------------------------------------------------------------
class InventoryBatch(BaseModel):
    id: str
    org_id: str
    warehouse_id: str
    product_id: str
    batch_number: str
    supplier_reference: str
    mfg_date: str
    expiry_date: str
    quantity: int
    reserved_quantity: int = 0
    damaged_quantity: int = 0
    unit_cost: float
    storage_bin: str
    qr_code_id: str
    status: str = "active"  # "active", "quarantined", "expired", "depleted"

class InventoryItem(BaseModel):
    id: str
    org_id: str
    warehouse_id: str
    product_id: str
    total_quantity: int
    reserved_quantity: int
    available_quantity: int
    damaged_quantity: int
    in_transit_quantity: int
    safety_stock: int
    reorder_point: int
    batches: List[InventoryBatch] = []

class MovementType(str, Enum):
    RECEIPT = "receipt"
    DISPATCH = "dispatch"
    TRANSFER_REQUEST = "transfer_request"
    TRANSFER_OUT = "transfer_out"
    TRANSFER_IN = "transfer_in"
    TRANSFER_DISPATCH = "transfer_dispatch"
    TRANSFER_RECEIVE = "transfer_receive"
    TRANSFER_CANCEL = "transfer_cancel"
    RESERVATION = "reservation"
    RELEASE_RESERVATION = "release_reservation"
    ADJUSTMENT = "adjustment"
    CYCLE_COUNT = "cycle_count"
    DAMAGE_REPORT = "damage_report"
    DISCREPANCY_RESOLUTION = "discrepancy_resolution"
    QUARANTINE = "quarantine"

class InventoryMovement(BaseModel):
    id: str
    org_id: str
    correlation_id: str
    product_id: str
    batch_id: Optional[str] = None
    source_warehouse_id: Optional[str] = None
    destination_id: Optional[str] = None
    movement_type: MovementType
    quantity_changed: int
    unit: str = "units"
    balance_after: int
    actor_id: str
    actor_name: str
    actor_role: str = "operator"
    reason: str
    timestamp: str
    resulting_status: str = "COMMITTED"

# -------------------------------------------------------------
# Stock Mutation Requests
# -------------------------------------------------------------
class ReceiveStockRequest(BaseModel):
    correlation_id: str
    warehouse_id: str
    product_id: str
    batch_number: str
    supplier_reference: str
    mfg_date: str
    expiry_date: str
    quantity: int
    unit_cost: float
    storage_bin: str
    notes: Optional[str] = None

class DispatchStockRequest(BaseModel):
    correlation_id: str
    warehouse_id: str
    product_id: str
    batch_id: Optional[str] = None
    destination_id: str
    quantity: int
    reason: str = "Sales order fulfillment"

class StockReservationRequest(BaseModel):
    correlation_id: str
    warehouse_id: str
    product_id: str
    batch_id: Optional[str] = None
    quantity: int
    order_id: Optional[str] = None
    reason: str = "Order allocation hold"

class ReleaseReservationRequest(BaseModel):
    correlation_id: str
    warehouse_id: str
    product_id: str
    batch_id: Optional[str] = None
    quantity: int
    order_id: Optional[str] = None
    reason: str = "Order cancellation or timeout"

class StockAdjustmentRequest(BaseModel):
    correlation_id: str
    warehouse_id: str
    product_id: str
    batch_id: str
    new_quantity: int
    reason: str

class DamageReportRequest(BaseModel):
    correlation_id: str
    warehouse_id: str
    product_id: str
    batch_id: str
    damaged_quantity: int
    reason: str
    photo_url: Optional[str] = None

class CycleCountRequest(BaseModel):
    correlation_id: str
    warehouse_id: str
    product_id: str
    batch_id: str
    counted_quantity: int
    storage_bin: Optional[str] = None
    notes: Optional[str] = None

class DiscrepancyResolutionRequest(BaseModel):
    correlation_id: str
    warehouse_id: str
    product_id: str
    batch_id: str
    discrepancy_type: str = "missing"  # "damaged", "missing", "found", "expired", "mislabeled"
    quantity_delta: int
    resolution_action: str = "write_off"  # "write_off", "quarantine", "restock", "relabel"
    reason: str

# -------------------------------------------------------------
# Inter-Warehouse Transfer Models & State Machine
# -------------------------------------------------------------
class TransferStatus(str, Enum):
    REQUESTED = "requested"
    PENDING = "pending"  # Backward compatibility alias
    APPROVED = "approved"
    DISPATCHED = "dispatched"
    IN_TRANSIT = "in_transit"
    RECEIVED = "received"
    REJECTED = "rejected"
    CANCELLED = "cancelled"

ALLOWED_TRANSFER_TRANSITIONS = {
    TransferStatus.REQUESTED: [TransferStatus.APPROVED, TransferStatus.REJECTED, TransferStatus.CANCELLED],
    TransferStatus.PENDING: [TransferStatus.APPROVED, TransferStatus.REJECTED, TransferStatus.CANCELLED],
    TransferStatus.APPROVED: [TransferStatus.DISPATCHED, TransferStatus.IN_TRANSIT, TransferStatus.CANCELLED],
    TransferStatus.DISPATCHED: [TransferStatus.IN_TRANSIT, TransferStatus.RECEIVED],
    TransferStatus.IN_TRANSIT: [TransferStatus.RECEIVED],
    TransferStatus.RECEIVED: [],   # Terminal
    TransferStatus.REJECTED: [],   # Terminal
    TransferStatus.CANCELLED: [],  # Terminal
}

class TransferItem(BaseModel):
    product_id: str
    batch_id: Optional[str] = None
    quantity: int
    unit_cost: float

class InterWarehouseTransfer(BaseModel):
    id: str
    org_id: str
    transfer_number: str
    source_warehouse_id: str
    target_warehouse_id: str
    items: List[TransferItem]
    status: TransferStatus = TransferStatus.REQUESTED
    requested_by_id: str
    requested_by_name: str
    approved_by_id: Optional[str] = None
    approved_by_name: Optional[str] = None
    carrier_name: Optional[str] = None
    tracking_number: Optional[str] = None
    shipped_at: Optional[str] = None
    received_at: Optional[str] = None
    estimated_transport_cost: float = 0.0
    notes: Optional[str] = ""
    created_at: str
    updated_at: str

class TransferApprovalRequest(BaseModel):
    transfer_id: str
    approved: bool
    notes: Optional[str] = ""

class TransferDispatchRequest(BaseModel):
    transfer_id: str
    carrier_name: Optional[str] = None
    tracking_number: Optional[str] = None
    notes: Optional[str] = ""

class TransferReceiveRequest(BaseModel):
    transfer_id: str
    damaged_quantity: int = 0
    condition: str = "intact"  # "intact", "excursion", "damaged"
    notes: Optional[str] = ""

class TransferCancelRequest(BaseModel):
    transfer_id: str
    reason: str = "Cancelled by authorized manager"

# -------------------------------------------------------------
# Optimization & Scenario Models
# -------------------------------------------------------------
class ScenarioModifiers(BaseModel):
    disrupted_warehouse_ids: List[str] = []
    demand_surge_percent: float = 0.0  # e.g., +25%
    fuel_transport_cost_multiplier: float = 1.0  # e.g., 1.5x
    expiring_soon_penalty_multiplier: float = 1.0
    supplier_delay_days: int = 0

class OptimizationRunRequest(BaseModel):
    product_ids: Optional[List[str]] = None
    destination_ids: Optional[List[str]] = None
    horizon_days: int = 7
    allow_split_shipments: bool = True
    fefo_priority_weight: float = 1.2
    scenario: Optional[ScenarioModifiers] = None

class AllocationRecommendation(BaseModel):
    id: str
    product_id: str
    product_sku: str
    product_name: str
    source_warehouse_id: str
    source_warehouse_name: str
    destination_id: str
    destination_name: str
    allocated_quantity: int
    requested_demand: int
    unmet_demand: int = 0
    unit_transport_cost: float
    total_transport_cost: float
    estimated_delivery_hours: float
    expiry_risk_score: float = 0.0  # 0.0 to 1.0
    stockout_risk_after: float = 0.0
    has_expiry_risk: bool = False
    has_stockout_risk: bool = False
    constraint_status: str = "OPTIMAL"  # OPTIMAL, FEASIBLE, CAPACITY_CONSTRAINED, INFEASIBLE
    rationale: str
    baseline_allocated_quantity: Optional[int] = None
    baseline_transport_cost: Optional[float] = None
    baseline_savings_amount: Optional[float] = None
    model_version: str = "ortools-scip-v2.1"
    data_version: str = "seed-triwiz-2026"
    alternative_options: List[Dict[str, Any]] = []

class OptimizationSummary(BaseModel):
    total_modeled_cost: float
    total_demand_units: int
    total_allocated_units: int
    fill_rate_percent: float
    stockout_units: int
    estimated_wastage_risk_units: int
    transportation_cost: float
    shortage_penalty_cost: float
    wastage_penalty_cost: float
    execution_time_ms: float
    solver_status: str
    solver_name: str  # "OR-Tools SCIP MIP" or "Greedy Baseline Heuristic"
    hard_constraints_enforced: bool = True

class OptimizationResult(BaseModel):
    run_id: str
    timestamp: str
    parameters: OptimizationRunRequest
    optimized: OptimizationSummary
    baseline_heuristic: OptimizationSummary
    recommendations: List[AllocationRecommendation]
    savings_amount: float
    savings_percent: float
    model_version: str = "ortools-scip-v2.1"
    data_version: str = "seed-triwiz-2026"
    hard_constraints_satisfied: bool = True
    diagnostic_messages: List[str] = []

# -------------------------------------------------------------
# Demand Forecasting Models
# -------------------------------------------------------------
class ForecastDataPoint(BaseModel):
    date: str
    historical_actual: Optional[float] = None
    baseline_ma: Optional[float] = None
    ml_forecast: Optional[float] = None
    upper_bound: Optional[float] = None
    lower_bound: Optional[float] = None

class ForecastEvaluation(BaseModel):
    model_name: str
    mae: float
    rmse: float
    r2_score: float
    mape_percent: Optional[float] = None
    baseline_ma_mae: Optional[float] = None
    baseline_ma_rmse: Optional[float] = None
    horizon_days: int
    holdout_sample_size: int
    data_provenance: str = "calibrated_synthetic_historical_series"

class ProductForecastResult(BaseModel):
    product_id: str
    product_name: str
    sku: str
    evaluation: ForecastEvaluation
    timeline: List[ForecastDataPoint]
    model_version: str = "scikit-ridge-v1.2"
    data_version: str = "seed-triwiz-2026"

# -------------------------------------------------------------
# IoT Telemetry Models
# -------------------------------------------------------------
class SensorReading(BaseModel):
    id: Optional[str] = None
    device_id: str
    org_id: str
    warehouse_id: str
    storage_zone: str
    timestamp: str
    server_received_at: Optional[str] = None
    temperature_c: float
    humidity_percent: float
    battery_level_percent: float = 100.0
    rssi_dbm: Optional[int] = -65
    door_open: bool = False
    is_valid: bool = True
    is_simulated: bool = False
    data_source: str = "ESP32_SECURE_HARDWARE"

class IoTDevice(BaseModel):
    device_id: str
    org_id: str
    warehouse_id: str
    storage_zone: str
    device_name: str
    mac_address: str
    ip_address: Optional[str] = "192.168.1.101"
    last_ping: Optional[str] = None
    is_online: bool = False
    firmware_version: str = "v2.5.0-esp32-secure"
    temp_min_threshold: float = 2.0
    temp_max_threshold: float = 8.0
    humidity_max_threshold: float = 65.0
    ping_interval_seconds: int = 60
    device_api_key: Optional[str] = None
    health_status: str = "HEALTHY"

class IoTDeviceRegistrationRequest(BaseModel):
    device_id: str
    device_name: str
    warehouse_id: str
    storage_zone: str
    mac_address: str
    firmware_version: Optional[str] = "v2.5.0-esp32-secure"
    temp_min_threshold: float = 2.0
    temp_max_threshold: float = 8.0
    humidity_max_threshold: float = 65.0
    ping_interval_seconds: int = 60
    device_api_key: Optional[str] = None

class IoTDeviceConfigUpdateRequest(BaseModel):
    device_name: Optional[str] = None
    storage_zone: Optional[str] = None
    temp_min_threshold: Optional[float] = None
    temp_max_threshold: Optional[float] = None
    humidity_max_threshold: Optional[float] = None
    ping_interval_seconds: Optional[int] = None

class TelemetryPayload(BaseModel):
    device_id: str
    temperature_c: Optional[float] = None
    temperature: Optional[float] = None
    temperature_unit: str = "C"  # "C", "F"
    humidity_percent: float
    timestamp: Optional[Any] = None
    battery_level_percent: Optional[float] = 98.0
    rssi_dbm: Optional[int] = -65
    door_open: Optional[bool] = False
    boot_count: Optional[int] = 1
    data_source: Optional[str] = "ESP32_SECURE_HARDWARE"
    supplied_org_id: Optional[str] = None
    supplied_warehouse_id: Optional[str] = None

class IoTAlert(BaseModel):
    id: str
    org_id: str
    warehouse_id: str
    device_id: str
    alert_type: str  # "temp_excursion", "humidity_breach", "device_offline", "door_ajar", "low_battery"
    severity: str    # "critical", "warning", "info"
    message: str
    reading_value: float
    threshold_value: float
    timestamp: str
    acknowledged: bool = False
    acknowledged_by: Optional[str] = None
    acknowledged_at: Optional[str] = None

class IoTReadingAggregate(BaseModel):
    id: str
    device_id: str
    warehouse_id: str
    org_id: str
    hour_bucket: str
    readings_count: int
    min_temp: float
    max_temp: float
    avg_temp: float
    avg_humidity: float
    excursion_count: int

# -------------------------------------------------------------
# WhatsApp Bot Models
# -------------------------------------------------------------
class WhatsAppIncomingMessage(BaseModel):
    from_number: str
    message_text: str
    timestamp: str
    message_id: str

class WhatsAppResponse(BaseModel):
    reply_text: str
    action_taken: Optional[str] = None
    correlation_id: Optional[str] = None
    status: str = "delivered"
    is_simulated: bool = False

class WhatsAppConsentUpdate(BaseModel):
    phone_number: str
    opted_in: bool

class WhatsAppOutboundAlertRequest(BaseModel):
    alert_type: str  # "excursion", "stockout", "transfer_approval"
    target_phone: Optional[str] = None
    target_role: Optional[str] = "warehouse_manager"
    warehouse_id: Optional[str] = None
    product_id: Optional[str] = None
    transfer_id: Optional[str] = None
    message: Optional[str] = None

# -------------------------------------------------------------
# Audit Log Models
# -------------------------------------------------------------
class AuditLogEntry(BaseModel):
    id: str
    org_id: str
    actor_id: str
    actor_name: str
    actor_role: str
    action: str
    target_entity: str
    entity_id: str
    details: Dict[str, Any]
    ip_address: Optional[str] = "127.0.0.1"
    timestamp: str
