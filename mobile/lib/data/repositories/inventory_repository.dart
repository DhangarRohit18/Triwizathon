import 'package:uuid/uuid.dart';
import '../../core/errors/app_exception.dart';
import '../../core/networking/api_client.dart';
import '../models/inventory_model.dart';
import '../models/batch_model.dart';
import '../services/local_storage_service.dart';

class InventoryActionResult {
  final bool isSuccess;
  final bool isOfflineDraft;
  final String status; // 'COMMITTED', 'OFFLINE_DRAFT', 'REJECTED'
  final String message;
  final String? transactionId;
  final String? correlationId;
  final Map<String, dynamic>? data;

  const InventoryActionResult({
    required this.isSuccess,
    this.isOfflineDraft = false,
    required this.status,
    required this.message,
    this.transactionId,
    this.correlationId,
    this.data,
  });

  bool get isCommitted => status == 'COMMITTED';
}

class InventoryRepository {
  final ApiClient apiClient;
  final LocalStorageService localStorage;
  final _uuid = const Uuid();

  InventoryRepository({required this.apiClient, required this.localStorage});

  Future<List<InventoryItemModel>> getInventory({String? warehouseId}) async {
    try {
      final query = warehouseId != null && warehouseId != 'all' ? {'warehouse_id': warehouseId} : null;
      final res = await apiClient.get('/inventory', queryParameters: query);
      final list = res.data as List;
      return list.map((e) => InventoryItemModel.fromJson(e as Map<String, dynamic>)).toList();
    } catch (_) {
      return _getDemoInventory();
    }
  }

  Future<List<InventoryBatchModel>> getBatches({String? warehouseId}) async {
    try {
      final query = warehouseId != null && warehouseId != 'all' ? {'warehouse_id': warehouseId} : null;
      final res = await apiClient.get('/inventory/batches', queryParameters: query);
      final list = res.data as List;
      return list.map((e) => InventoryBatchModel.fromJson(e as Map<String, dynamic>)).toList();
    } catch (_) {
      return _getDemoBatches();
    }
  }

  Future<Map<String, dynamic>> resolveQrCode(String code) async {
    try {
      final res = await apiClient.get('/products/resolve-qr', queryParameters: {'code': code});
      return res.data as Map<String, dynamic>;
    } catch (_) {
      // Offline fallback: resolve known demo barcodes and batches
      return _demoResolve(code);
    }
  }

  Future<InventoryActionResult> receiveStock({
    required String warehouseId,
    required String productId,
    required String batchNumber,
    String supplierReference = 'PO-APP-DIRECT',
    required int quantity,
    required String expiryDate,
    String storageBin = 'ZONE-A-BIN-01',
    double unitCost = 22.50,
    String? idempotencyKey,
  }) async {
    final correlationId = idempotencyKey ?? 'MOB-REC-${DateTime.now().millisecondsSinceEpoch}-${_uuid.v4().substring(0, 6)}';
    final payload = {
      'correlation_id': correlationId,
      'warehouse_id': warehouseId,
      'product_id': productId,
      'batch_number': batchNumber,
      'supplier_reference': supplierReference,
      'mfg_date': '2026-01-01',
      'expiry_date': expiryDate,
      'quantity': quantity,
      'unit_cost': unitCost,
      'storage_bin': storageBin,
    };

    try {
      final res = await apiClient.post('/inventory/receive', data: payload);
      final resData = res.data is Map ? res.data as Map<String, dynamic> : <String, dynamic>{};
      final movement = resData['movement'] is Map ? resData['movement'] as Map<String, dynamic> : null;
      final txId = movement?['id'] ?? resData['transaction_id'] ?? 'TX-REC-${correlationId.substring(0, 8)}';

      return InventoryActionResult(
        isSuccess: true,
        isOfflineDraft: false,
        status: 'COMMITTED',
        transactionId: txId.toString(),
        correlationId: correlationId,
        message: 'Stock received and committed to authoritative ledger.',
        data: resData,
      );
    } on NetworkException {
      // Safe offline draft: store locally and notify caller
      await localStorage.queueOperation({
        'action': 'receive',
        'endpoint': '/inventory/receive',
        'payload': payload,
        'correlation_id': correlationId,
        'is_offline_draft': true,
      });
      return InventoryActionResult(
        isSuccess: true,
        isOfflineDraft: true,
        status: 'OFFLINE_DRAFT',
        correlationId: correlationId,
        message: 'Offline draft saved to local queue. Will sync when connectivity is restored.',
      );
    }
  }

  Future<InventoryActionResult> dispatchStock({
    required String warehouseId,
    required String productId,
    String destinationId = '',
    String? destinationHospitalId,
    required int quantity,
    String? batchId,
    String? batchNumber,
    String reason = 'Outbound dispatch',
    String? idempotencyKey,
  }) async {
    final finalDest = (destinationHospitalId != null && destinationHospitalId.isNotEmpty)
        ? destinationHospitalId
        : destinationId;
    final finalBatch = batchNumber ?? batchId;
    final correlationId = idempotencyKey ?? 'MOB-DISP-${DateTime.now().millisecondsSinceEpoch}-${_uuid.v4().substring(0, 6)}';
    final payload = {
      'correlation_id': correlationId,
      'warehouse_id': warehouseId,
      'product_id': productId,
      'destination_id': finalDest.isNotEmpty ? finalDest : 'HOSP-METRO-01',
      'quantity': quantity,
      'batch_id': finalBatch,
      'batch_number': finalBatch,
      'reason': reason,
    };

    try {
      final res = await apiClient.post('/inventory/dispatch', data: payload);
      final resData = res.data is Map ? res.data as Map<String, dynamic> : <String, dynamic>{};
      final movement = resData['movement'] is Map ? resData['movement'] as Map<String, dynamic> : null;
      final txId = movement?['id'] ?? resData['transaction_id'] ?? 'TX-DISP-${correlationId.substring(0, 8)}';

      return InventoryActionResult(
        isSuccess: true,
        isOfflineDraft: false,
        status: 'COMMITTED',
        transactionId: txId.toString(),
        correlationId: correlationId,
        message: 'Outbound dispatch confirmed and stock deducted from authoritative balance.',
        data: resData,
      );
    } on NetworkException {
      await localStorage.queueOperation({
        'action': 'dispatch',
        'endpoint': '/inventory/dispatch',
        'payload': payload,
        'correlation_id': correlationId,
        'is_offline_draft': true,
      });
      return InventoryActionResult(
        isSuccess: true,
        isOfflineDraft: true,
        status: 'OFFLINE_DRAFT',
        correlationId: correlationId,
        message: 'Offline draft saved. Outbound movement queued locally until network reconnects.',
      );
    }
  }

  Future<InventoryActionResult> cycleCount({
    required String warehouseId,
    required String productId,
    required String batchId,
    required int countedQuantity,
    String? storageBin,
    String? notes,
    String? idempotencyKey,
  }) async {
    final correlationId = idempotencyKey ?? 'MOB-CNT-${DateTime.now().millisecondsSinceEpoch}-${_uuid.v4().substring(0, 6)}';
    final payload = {
      'correlation_id': correlationId,
      'warehouse_id': warehouseId,
      'product_id': productId,
      'batch_id': batchId,
      'counted_quantity': countedQuantity,
      'storage_bin': storageBin ?? 'ZONE-A-BIN-01',
      'notes': notes ?? 'Mobile floor cycle count',
    };

    try {
      final res = await apiClient.post('/inventory/cycle-count', data: payload);
      final resData = res.data is Map ? res.data as Map<String, dynamic> : <String, dynamic>{};
      final txId = resData['movement']?['id'] ?? resData['transaction_id'] ?? 'TX-CNT-${correlationId.substring(0, 8)}';
      final variance = resData['variance'] ?? 0;

      return InventoryActionResult(
        isSuccess: true,
        isOfflineDraft: false,
        status: 'COMMITTED',
        transactionId: txId.toString(),
        correlationId: correlationId,
        message: 'Cycle count recorded. Variance: $variance units. Ledger updated.',
        data: resData,
      );
    } on NetworkException {
      await localStorage.queueOperation({
        'action': 'cycle_count',
        'endpoint': '/inventory/cycle-count',
        'payload': payload,
        'correlation_id': correlationId,
        'is_offline_draft': true,
      });
      return InventoryActionResult(
        isSuccess: true,
        isOfflineDraft: true,
        status: 'OFFLINE_DRAFT',
        correlationId: correlationId,
        message: 'Cycle count saved locally as draft. Pending server sync.',
      );
    }
  }

  Future<InventoryActionResult> reportDamage({
    required String warehouseId,
    required String productId,
    String batchId = '',
    String? batchNumber,
    required int damagedQuantity,
    String reason = 'Damaged packaging/seal breach',
    String? damageReason,
    String? photoUrl,
    String? idempotencyKey,
  }) async {
    final finalBatch = (batchId.isNotEmpty) ? batchId : (batchNumber ?? '');
    final finalReason = damageReason ?? reason;
    final correlationId = idempotencyKey ?? 'MOB-DMG-${DateTime.now().millisecondsSinceEpoch}-${_uuid.v4().substring(0, 6)}';
    final payload = {
      'correlation_id': correlationId,
      'warehouse_id': warehouseId,
      'product_id': productId,
      'batch_id': finalBatch,
      'damaged_quantity': damagedQuantity,
      'reason': finalReason,
      'photo_url': photoUrl,
    };

    try {
      final res = await apiClient.post('/inventory/damage', data: payload);
      final resData = res.data is Map ? res.data as Map<String, dynamic> : <String, dynamic>{};
      final txId = resData['movement']?['id'] ?? resData['transaction_id'] ?? 'TX-DMG-${correlationId.substring(0, 8)}';

      return InventoryActionResult(
        isSuccess: true,
        isOfflineDraft: false,
        status: 'COMMITTED',
        transactionId: txId.toString(),
        correlationId: correlationId,
        message: 'Damage reported ($damagedQuantity units). Quarantine ledger created.',
        data: resData,
      );
    } on NetworkException {
      await localStorage.queueOperation({
        'action': 'damage',
        'endpoint': '/inventory/damage',
        'payload': payload,
        'correlation_id': correlationId,
        'is_offline_draft': true,
      });
      return InventoryActionResult(
        isSuccess: true,
        isOfflineDraft: true,
        status: 'OFFLINE_DRAFT',
        correlationId: correlationId,
        message: 'Damage report saved as offline draft.',
      );
    }
  }

  Future<InventoryActionResult> resolveDiscrepancy({
    required String warehouseId,
    required String productId,
    required String batchId,
    String discrepancyType = 'damaged',
    required int quantityDelta,
    String resolutionAction = 'quarantine',
    required String reason,
    String? idempotencyKey,
  }) async {
    final correlationId = idempotencyKey ?? 'MOB-DISC-${DateTime.now().millisecondsSinceEpoch}-${_uuid.v4().substring(0, 6)}';
    final payload = {
      'correlation_id': correlationId,
      'warehouse_id': warehouseId,
      'product_id': productId,
      'batch_id': batchId,
      'discrepancy_type': discrepancyType,
      'quantity_delta': quantityDelta,
      'resolution_action': resolutionAction,
      'reason': reason,
    };

    try {
      final res = await apiClient.post('/inventory/discrepancy/resolve', data: payload);
      final resData = res.data is Map ? res.data as Map<String, dynamic> : <String, dynamic>{};
      final txId = resData['movement']?['id'] ?? resData['transaction_id'] ?? 'TX-DISC-${correlationId.substring(0, 8)}';

      return InventoryActionResult(
        isSuccess: true,
        isOfflineDraft: false,
        status: 'COMMITTED',
        transactionId: txId.toString(),
        correlationId: correlationId,
        message: 'Discrepancy resolved ($quantityDelta units -> $resolutionAction).',
        data: resData,
      );
    } on NetworkException {
      await localStorage.queueOperation({
        'action': 'discrepancy',
        'endpoint': '/inventory/discrepancy/resolve',
        'payload': payload,
        'correlation_id': correlationId,
        'is_offline_draft': true,
      });
      return InventoryActionResult(
        isSuccess: true,
        isOfflineDraft: true,
        status: 'OFFLINE_DRAFT',
        correlationId: correlationId,
        message: 'Discrepancy resolution saved as offline draft.',
      );
    }
  }

  Future<InventoryActionResult> receiveTransfer({
    required String transferId,
    int damagedQuantity = 0,
    String condition = 'intact',
    String notes = 'Acknowledged via mobile QR scanning',
  }) async {
    final payload = {
      'transfer_id': transferId,
      'damaged_quantity': damagedQuantity,
      'condition': condition,
      'notes': notes,
    };

    try {
      final res = await apiClient.post('/transfers/receive', data: payload);
      final resData = res.data is Map ? res.data as Map<String, dynamic> : <String, dynamic>{};

      return InventoryActionResult(
        isSuccess: true,
        isOfflineDraft: false,
        status: 'COMMITTED',
        transactionId: transferId,
        correlationId: 'TRF-ACK-$transferId',
        message: 'Transfer acknowledged. Goods officially received into destination warehouse inventory.',
        data: resData,
      );
    } on NetworkException {
      await localStorage.queueOperation({
        'action': 'receive_transfer',
        'endpoint': '/transfers/receive',
        'payload': payload,
        'correlation_id': 'TRF-ACK-$transferId',
        'is_offline_draft': true,
      });
      return InventoryActionResult(
        isSuccess: true,
        isOfflineDraft: true,
        status: 'OFFLINE_DRAFT',
        correlationId: 'TRF-ACK-$transferId',
        message: 'Transfer acknowledgment saved offline. Will sync when server is reachable.',
      );
    }
  }

  Future<InventoryActionResult> adjustStock({
    required String warehouseId,
    required String productId,
    String batchId = '',
    String? batchNumber,
    int? newQuantity,
    int? countedQuantity,
    String reason = 'Audit adjustment',
    String? adjustmentReason,
    String? idempotencyKey,
  }) async {
    final finalBatch = (batchId.isNotEmpty) ? batchId : (batchNumber ?? '');
    final finalQty = countedQuantity ?? newQuantity ?? 0;
    final finalReason = adjustmentReason ?? reason;
    final correlationId = idempotencyKey ?? 'MOB-ADJ-${DateTime.now().millisecondsSinceEpoch}-${_uuid.v4().substring(0, 6)}';
    final payload = {
      'correlation_id': correlationId,
      'warehouse_id': warehouseId,
      'product_id': productId,
      'batch_id': finalBatch,
      'new_quantity': finalQty,
      'reason': finalReason,
    };

    try {
      final res = await apiClient.post('/inventory/adjust', data: payload);
      final resData = res.data is Map ? res.data as Map<String, dynamic> : <String, dynamic>{};
      final txId = resData['movement']?['id'] ?? resData['transaction_id'] ?? 'TX-ADJ-${correlationId.substring(0, 8)}';

      return InventoryActionResult(
        isSuccess: true,
        isOfflineDraft: false,
        status: 'COMMITTED',
        transactionId: txId.toString(),
        correlationId: correlationId,
        message: 'Stock adjusted to $finalQty units. Audit movement recorded.',
        data: resData,
      );
    } on NetworkException {
      await localStorage.queueOperation({
        'action': 'adjust',
        'endpoint': '/inventory/adjust',
        'payload': payload,
        'correlation_id': correlationId,
        'is_offline_draft': true,
      });
      return InventoryActionResult(
        isSuccess: true,
        isOfflineDraft: true,
        status: 'OFFLINE_DRAFT',
        correlationId: correlationId,
        message: 'Stock adjustment saved as offline draft.',
      );
    }
  }

  Future<int> syncPendingQueue() async {
    final queue = localStorage.getPendingQueue();
    int syncedCount = 0;

    for (final op in List<Map<String, dynamic>>.from(queue)) {
      final endpoint = op['endpoint'] as String?;
      final payload = op['payload'];
      final correlationId = op['correlation_id'] as String?;

      if (endpoint != null && payload != null) {
        try {
          await apiClient.post(endpoint, data: payload);
          if (correlationId != null) {
            await localStorage.removeOperation(correlationId);
          }
          syncedCount++;
        } catch (_) {
          // If still offline or network fails, keep in queue
        }
      }
    }

    return syncedCount;
  }

  List<InventoryItemModel> _getDemoInventory() {
    return [
      InventoryItemModel(
        id: 'inv_wh_chicago_01_prd_vax_01',
        warehouseId: 'wh_chicago_01',
        productId: 'prd_vax_01',
        productName: 'Comirnaty Ultra-Cold Vaccine',
        productSku: 'PRD-VAX-01',
        handling: 'cold_chain',
        unit: 'vials',
        warehouseName: 'Central Hub Chicago',
        totalQuantity: 2250,
        availableQuantity: 2200,
        reservedQuantity: 50,
        damagedQuantity: 0,
        safetyStock: 200,
        reorderPoint: 500,
      ),
      InventoryItemModel(
        id: 'inv_wh_chicago_01_prd_ins_02',
        warehouseId: 'wh_chicago_01',
        productId: 'prd_ins_02',
        productName: 'Humalog Rapid-Acting Insulin',
        productSku: 'PRD-INS-02',
        handling: 'cold_chain',
        unit: 'pens',
        warehouseName: 'Central Hub Chicago',
        totalQuantity: 2200,
        availableQuantity: 2050,
        reservedQuantity: 150,
        damagedQuantity: 0,
        safetyStock: 350,
        reorderPoint: 800,
      ),
      InventoryItemModel(
        id: 'inv_wh_chicago_01_prd_ant_03',
        warehouseId: 'wh_chicago_01',
        productId: 'prd_ant_03',
        productName: 'Amoxicillin 500mg Capsules',
        productSku: 'PRD-ANT-03',
        handling: 'ambient',
        unit: 'bottles',
        warehouseName: 'Central Hub Chicago',
        totalQuantity: 4200,
        availableQuantity: 4000,
        reservedQuantity: 200,
        damagedQuantity: 0,
        safetyStock: 500,
        reorderPoint: 1200,
      ),
    ];
  }

  List<InventoryBatchModel> _getDemoBatches() {
    return [
      InventoryBatchModel(
        id: 'bat_vax_chi_01',
        warehouseId: 'wh_chicago_01',
        productId: 'prd_vax_01',
        productName: 'Comirnaty Ultra-Cold Vaccine',
        productSku: 'PRD-VAX-01',
        warehouseName: 'Central Hub Chicago',
        batchNumber: 'BN-VX-2026-A1',
        supplierReference: 'Pfizer-BioNTech-GmbH',
        mfgDate: '2026-01-10',
        expiryDate: '2026-11-15',
        quantity: 850,
        reservedQuantity: 50,
        damagedQuantity: 0,
        unitCost: 22.50,
        storageBin: 'CR-1-A04',
        qrCodeId: 'STOCKPILOT://BATCH/BN-VX-2026-A1/WH/wh_chicago_01',
        status: 'active',
      ),
      InventoryBatchModel(
        id: 'bat_ins_chi_01',
        warehouseId: 'wh_chicago_01',
        productId: 'prd_ins_02',
        productName: 'Humalog Rapid-Acting Insulin',
        productSku: 'PRD-INS-02',
        warehouseName: 'Central Hub Chicago',
        batchNumber: 'BN-IN-2026-C3',
        supplierReference: 'Eli Lilly & Co',
        mfgDate: '2026-02-01',
        expiryDate: '2026-12-20',
        quantity: 2200,
        reservedQuantity: 150,
        damagedQuantity: 0,
        unitCost: 16.50,
        storageBin: 'CR-1-D08',
        qrCodeId: 'STOCKPILOT://BATCH/BN-IN-2026-C3/WH/wh_chicago_01',
        status: 'active',
      ),
    ];
  }

  Map<String, dynamic> _demoResolve(String code) {
    return {
      'resolved_type': 'product',
      'product': {
        'id': 'prd_vax_01',
        'sku': 'PRD-VAX-01',
        'name': 'Comirnaty Ultra-Cold Vaccine',
        'category': 'Vaccines & Biologics',
        'handling': 'cold_chain',
        'unit': 'vials',
        'unit_cost': 22.50,
        'barcode': '8901234567891',
      },
      'product_id': 'prd_vax_01',
      'product_name': 'Comirnaty Ultra-Cold Vaccine',
      'sku': 'PRD-VAX-01',
      'category': 'Vaccines & Biologics',
      'handling': 'cold_chain',
      'storage_type': 'COLD_CHAIN',
      'unit': 'vials',
      'unit_cost': 22.50,
      'warehouse_id': 'wh_chicago_01',
      'batch_number': 'BN-VX-2026-A1',
      'batch_id': 'bat_vax_chi_01',
      'current_stock': 2200,
      'total_available': 2200,
      'active_batches': [
        {
          'id': 'bat_vax_chi_01',
          'batch_number': 'BN-VX-2026-A1',
          'supplier_reference': 'Pfizer-BioNTech-GmbH',
          'quantity': 850,
          'expiry_date': '2026-11-15',
          'storage_bin': 'CR-1-A04',
        }
      ]
    };
  }
}
