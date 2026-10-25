export type RoleType = 
  | 'super_admin'
  | 'org_admin'
  | 'supply_chain_manager'
  | 'warehouse_manager'
  | 'distributor'
  | 'operator';

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: RoleType;
  org_id: string;
  warehouse_id?: string | null;
  warehouse_ids?: string[] | null;
  permissions?: string[] | null;
  phone_number?: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Warehouse {
  id: string;
  org_id: string;
  code: string;
  name: string;
  address: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  capacity_pallets: number;
  used_pallets: number;
  cold_storage_capacity: number;
  is_operational: boolean;
  operating_cost_per_pallet: number;
}

export interface Destination {
  id: string;
  org_id: string;
  code: string;
  name: string;
  type: string;
  city: string;
  lat: number;
  lng: number;
  service_level_priority: number;
}

export interface Product {
  id: string;
  org_id: string;
  sku: string;
  name: string;
  category: string;
  description?: string;
  unit: string;
  unit_cost: number;
  selling_price: number;
  handling: 'cold_chain' | 'deep_freeze' | 'ambient' | 'hazardous' | 'fragile';
  min_safety_stock: number;
  reorder_point: number;
  barcode: string;
  qr_code_payload: string;
  shelf_life_days: number;
  weight_kg: number;
}

export interface InventoryItem {
  id: string;
  org_id: string;
  warehouse_id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  handling: string;
  unit: string;
  warehouse_name: string;
  total_quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  damaged_quantity: number;
  in_transit_quantity: number;
  safety_stock: number;
  reorder_point: number;
}

export interface InventoryBatch {
  id: string;
  warehouse_id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  warehouse_name: string;
  batch_number: string;
  supplier_reference: string;
  mfg_date: string;
  expiry_date: string;
  quantity: number;
  reserved_quantity: number;
  damaged_quantity: number;
  unit_cost: number;
  storage_bin: string;
  qr_code_id: string;
  status: string;
}

export type Batch = InventoryBatch;

export interface InventoryMovement {
  id: string;
  correlation_id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  source_name: string;
  destination_name: string;
  movement_type: string;
  quantity_changed: number;
  balance_after: number;
  actor_name: string;
  reason: string;
  timestamp: string;
}

export interface AllocationRecommendation {
  id: string;
  product_id: string;
  product_sku: string;
  product_name: string;
  source_warehouse_id: string;
  source_warehouse_name: string;
  destination_id: string;
  destination_name: string;
  allocated_quantity: number;
  requested_demand: number;
  unit_transport_cost: number;
  total_transport_cost: number;
  estimated_delivery_hours: number;
  expiry_risk_score: number;
  stockout_risk_after: number;
  rationale: string;
  transferred?: boolean;
  transfer_id?: string;
  alternative_options?: Array<{ warehouse_name: string; distance_km: number; unit_cost: number }>;
}

export interface OptimizationSummary {
  total_modeled_cost: number;
  total_demand_units: number;
  total_allocated_units: number;
  fill_rate_percent: number;
  stockout_units: number;
  estimated_wastage_risk_units: number;
  transportation_cost: number;
  shortage_penalty_cost: number;
  wastage_penalty_cost: number;
  execution_time_ms: number;
  solver_status: string;
  solver_name: string;
  objective_value?: number;
}

export interface OptimizationResult {
  run_id: string;
  timestamp: string;
  input_snapshot?: Record<string, any>;
  optimized: OptimizationSummary;
  baseline_heuristic: OptimizationSummary;
  recommendations: AllocationRecommendation[];
  savings_amount: number;
  savings_percent: number;
  hard_constraints_satisfied?: boolean;
  diagnostic_messages?: string[];
}

export interface IoTDevice {
  device_id: string;
  warehouse_id: string;
  warehouse_name: string;
  storage_zone: string;
  device_name: string;
  mac_address: string;
  ip_address: string;
  last_ping: string;
  is_online: boolean;
  connectivity_status?: 'online' | 'stale' | 'offline';
  data_freshness_seconds?: number;
  last_seen_text?: string;
  firmware_version: string;
  temp_min_threshold: number;
  temp_max_threshold: number;
  humidity_max_threshold: number;
  current_temp: number;
  current_humidity: number;
}

export interface SensorReading {
  id: string;
  device_id: string;
  storage_zone: string;
  timestamp: string;
  temperature_c: number;
  humidity_percent: number;
  battery_level_percent: number;
  door_open: boolean;
  is_simulated?: boolean;
  data_source?: string;
}

export interface IoTAlert {
  id: string;
  device_id: string;
  alert_type: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  reading_value: number;
  threshold_value: number;
  timestamp: string;
  acknowledged: boolean;
  acknowledged_by?: string | null;
  acknowledged_at?: string | null;
  is_simulated?: boolean;
  data_source?: string;
}

export interface Transfer {
  id: string;
  transfer_number: string;
  source_warehouse_id: string;
  source_warehouse_name: string;
  target_warehouse_id: string;
  target_warehouse_name: string;
  items: Array<{ product_id: string; product_name: string; product_sku: string; quantity: number }>;
  status: 'pending' | 'approved' | 'in_transit' | 'received' | 'rejected';
  requested_by_name?: string;
  requested_by?: string;
  approved_by_name?: string | null;
  estimated_transport_cost: number;
  notes?: string;
  created_at: string;
}
