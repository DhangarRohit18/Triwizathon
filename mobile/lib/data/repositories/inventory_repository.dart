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
    final query = warehouseId != null && warehouseId != 'all' ? {'warehouse_id': warehouseId} : null;
    final res = await apiClient.get('/inventory', queryParameters: query);
    final list = res.data as List;
    return list.map((e) => InventoryItemModel.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<List<InventoryBatchModel>> getBatches({String? warehouseId}) async {
    final query = warehouseId != null && warehouseId != 'all' ? {'warehouse_id': warehouseId} : null;
    final res = await apiClient.get('/inventory/batches', queryParameters: query);
    final list = res.data as List;
    return list.map((e) => InventoryBatchModel.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<Map<String, dynamic>> resolveQrCode(String code) async {
    final res = await apiClient.get('/products/resolve-qr', queryParameters: {'code': code});
    return res.data as Map<String, dynamic>;
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
        } on NetworkException {
          // Server unreachable or connection timeout: keep in queue for future retry
          break;
        } catch (_) {
          // Terminal rejection (e.g. 400 validation error, 422 conflict, 403 forbidden):
          // Remove from retry queue to prevent queue blocking
          if (correlationId != null) {
            await localStorage.removeOperation(correlationId);
          }
        }
      }
    }

    return syncedCount;
  }
}

