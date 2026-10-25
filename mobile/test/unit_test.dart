import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stockpilot_mobile/core/config/api_config.dart';
import 'package:stockpilot_mobile/core/networking/api_client.dart';
import 'package:stockpilot_mobile/data/models/batch_model.dart';
import 'package:stockpilot_mobile/data/models/inventory_model.dart';
import 'package:stockpilot_mobile/data/models/iot_model.dart';
import 'package:stockpilot_mobile/data/models/task_model.dart';
import 'package:stockpilot_mobile/data/models/transfer_model.dart';
import 'package:stockpilot_mobile/data/models/user_model.dart';
import 'package:stockpilot_mobile/data/services/local_storage_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('Domain Data Models Unit Tests', () {
    test('UserModel parse and role mapping', () {
      final json = {
        'id': 'usr_op_01',
        'email': 'operator@stockpilot.ai',
        'name': 'Rahul Sharma',
        'role': 'WAREHOUSE_OPERATOR',
        'organization_id': 'org_triwiz_01',
        'warehouse_id': 'WH-CENTRAL-01',
        'warehouse_name': 'Central Distribution Hub (Bengaluru)',
      };

      final user = UserModel.fromJson(json);
      expect(user.id, 'usr_op_01');
      expect(user.role, UserRole.warehouseOperator);
      expect(user.role.displayName, 'Warehouse Operator');
    });

    test('InventoryItemModel low stock detection', () {
      final itemLow = InventoryItemModel(
        id: 'inv_01',
        productId: 'PROD-COV-VAX-01',
        productName: 'Covaxin Vaccine',
        productSku: 'SKU-COV-01',
        handling: 'COLD_CHAIN',
        unit: 'vials',
        warehouseId: 'WH-CENTRAL-01',
        warehouseName: 'Central WH',
        totalQuantity: 200,
        availableQuantity: 150,
        reservedQuantity: 50,
        damagedQuantity: 0,
        safetyStock: 300,
        reorderPoint: 500,
      );

      expect(itemLow.isLowStock, true);

      final itemSafe = itemLow.copyWith(quantityAvailable: 1000);
      expect(itemSafe.isLowStock, false);
    });

    test('InventoryBatchModel FEFO calculation', () {
      final now = DateTime.now();
      final expiringSoonDate = now.add(const Duration(days: 15)).toIso8601String();
      final safeDate = now.add(const Duration(days: 120)).toIso8601String();

      final batchExpiring = InventoryBatchModel(
        id: 'batch_01',
        productId: 'PROD-COV-VAX-01',
        productName: 'Covaxin',
        productSku: 'SKU-COV-01',
        warehouseName: 'Central WH',
        batchNumber: 'BATCH-COV-8821',
        warehouseId: 'WH-CENTRAL-01',
        supplierReference: 'PO-100',
        mfgDate: '2025-01-01',
        quantity: 450,
        reservedQuantity: 0,
        damagedQuantity: 0,
        unitCost: 15.0,
        storageBin: 'BIN-01',
        qrCodeId: 'QR-COV-8821',
        status: 'active',
        expiryDate: expiringSoonDate,
      );

      expect(batchExpiring.daysUntilExpiry, inInclusiveRange(14, 16));
      expect(batchExpiring.isExpiringSoon, true);

      final batchSafe = batchExpiring.copyWith(expiryDate: safeDate);
      expect(batchSafe.isExpiringSoon, false);
    });

    test('IoTDeviceModel temperature threshold breach detection', () {
      final normalDevice = IoTDeviceModel(
        deviceId: 'TEMP-ESP32-01',
        warehouseId: 'WH-CENTRAL-01',
        warehouseName: 'Central WH',
        currentTemp: 4.5,
        currentHumidity: 50.0,
        tempMinThreshold: 2.0,
        tempMaxThreshold: 8.0,
        isOnline: true,
      );

      expect(normalDevice.isBreached, false);

      final breachedDevice = normalDevice.copyWith(currentTemp: 9.8);
      expect(breachedDevice.isBreached, true);
    });

    test('TransferModel parse with nested TransferItemModel', () {
      final json = {
        'id': 'TR-2026-001',
        'transfer_number': 'TR-2026-001',
        'origin_warehouse_id': 'WH-CENTRAL-01',
        'origin_warehouse_name': 'Central WH',
        'destination_warehouse_id': 'WH-NORTH-02',
        'destination_warehouse_name': 'North Hub',
        'status': 'PENDING_APPROVAL',
        'created_by': 'Admin',
        'created_at': '2026-10-24T00:00:00',
        'items': [
          {
            'product_id': 'PROD-COV-VAX-01',
            'product_name': 'Covaxin',
            'batch_number': 'BATCH-COV-8821',
            'quantity': 300,
          }
        ],
      };

      final transfer = TransferModel.fromJson(json);
      expect(transfer.transferNumber, 'TR-2026-001');
      expect(transfer.items.length, 1);
      expect(transfer.items.first.quantity, 300);
    });

    test('LocalStorageService pending sync queue handles enqueue and clear', () async {
      SharedPreferences.setMockInitialValues({});

      await LocalStorageService.enqueuePendingSync(
        action: 'RECEIVE_STOCK',
        payload: {'product_id': 'PROD-01', 'qty': 100},
        idempotencyKey: 'idemp-test-1234',
      );

      var queue = await LocalStorageService.getPendingSyncQueue();
      expect(queue.length, 1);
      expect(queue.first['idempotency_key'], 'idemp-test-1234');

      await LocalStorageService.clearPendingSyncQueue();
      queue = await LocalStorageService.getPendingSyncQueue();
      expect(queue.length, 0);
    });

    test('UserModel role permissions and facility access scoping', () {
      // 1. Super Admin
      final superAdmin = UserModel(
        id: 'usr_sa',
        email: 'superadmin@stockpilot.ai',
        fullName: 'Super Admin',
        role: UserRole.superAdmin,
        orgId: 'system',
        permissions: ['platform:health_view', 'audit:view', 'organizations:manage'],
        warehouseIds: [],
      );
      expect(superAdmin.canAccessWarehouse('wh_any'), true);
      expect(superAdmin.canAccessIot, true);
      expect(superAdmin.canApproveTransfers, true);

      // 2. Distributor
      final distributor = UserModel(
        id: 'usr_dist',
        email: 'dist@pharma.com',
        fullName: 'Field Distributor',
        role: UserRole.distributor,
        orgId: 'org_01',
        permissions: ['scans:execute', 'delivery:confirm', 'damage:report'],
        warehouseIds: [],
      );
      expect(distributor.canAccessTasks, false);
      expect(distributor.canAccessIot, false);
      expect(distributor.canApproveTransfers, false);
      expect(distributor.canMutateInventory, false);

      // 3. Warehouse Operator with scoped facility
      final opCentral = UserModel(
        id: 'usr_op',
        email: 'op@stockpilot.ai',
        fullName: 'Central Floor Operator',
        role: UserRole.operator,
        orgId: 'org_01',
        warehouseIds: ['wh_central_01'],
        permissions: ['inventory:receive', 'inventory:dispatch', 'tasks:execute'],
      );
      expect(opCentral.canAccessTasks, true);
      expect(opCentral.canAccessIot, false);
      expect(opCentral.canApproveTransfers, false);
      expect(opCentral.canAccessWarehouse('wh_central_01'), true);
      expect(opCentral.canAccessWarehouse('wh_boston_02'), false);

      // 4. Warehouse Manager
      final whMgr = UserModel(
        id: 'usr_mgr',
        email: 'mgr@stockpilot.ai',
        fullName: 'Facility Manager',
        role: UserRole.warehouseManager,
        orgId: 'org_01',
        warehouseIds: ['wh_central_01'],
        permissions: ['inventory:receive', 'transfers:approve', 'alerts:manage'],
      );
      expect(whMgr.canApproveTransfers, true);
      expect(whMgr.canAccessIot, true);
      expect(whMgr.canAccessWarehouse('wh_central_01'), true);
      expect(whMgr.canAccessWarehouse('wh_other'), false);

      // 5. Strict role parsing rejects unknown roles
      expect(
        () => UserRole.fromString('UNKNOWN_HACKER_ROLE'),
        throwsFormatException,
      );

      // 6. Network-wide scope helpers
      expect(superAdmin.hasNetworkWideScope, true);
      expect(opCentral.hasNetworkWideScope, false);
      expect(whMgr.hasNetworkWideScope, false);
    });
  });

  group('ApiConfig URL Validation & Normalization Tests', () {
    test('Permits valid local development HTTP endpoints', () {
      expect(ApiConfig.validateAndNormalizeUrl('http://10.0.2.2:8000/api/v1'), 'http://10.0.2.2:8000/api/v1');
      expect(ApiConfig.validateAndNormalizeUrl('http://localhost:8000'), 'http://localhost:8000');
      expect(ApiConfig.validateAndNormalizeUrl('http://127.0.0.1:8000/api/v1/'), 'http://127.0.0.1:8000/api/v1');
      expect(ApiConfig.validateAndNormalizeUrl('http://192.168.1.50:8000'), 'http://192.168.1.50:8000');
    });

    test('Requires HTTPS for deployed remote production hosts', () {
      expect(
        ApiConfig.validateAndNormalizeUrl('https://api.stockpilot.ai/v1'),
        'https://api.stockpilot.ai/v1',
      );

      // Remote host using HTTP must be strictly rejected
      expect(
        () => ApiConfig.validateAndNormalizeUrl('http://api.stockpilot.ai/v1'),
        throwsFormatException,
      );
    });

    test('Rejects malformed URLs, empty strings, and embedded credentials', () {
      expect(() => ApiConfig.validateAndNormalizeUrl(''), throwsFormatException);
      expect(() => ApiConfig.validateAndNormalizeUrl('   '), throwsFormatException);
      expect(() => ApiConfig.validateAndNormalizeUrl('not-a-valid-url'), throwsFormatException);
      expect(() => ApiConfig.validateAndNormalizeUrl('ftp://example.com/api'), throwsFormatException);
      expect(
        () => ApiConfig.validateAndNormalizeUrl('https://admin:secret123@api.stockpilot.ai'),
        throwsFormatException,
      );
    });
  });

  group('ApiClient Dynamic Base URL Switching Tests', () {
    test('updateBaseUrl updates client options and persists to SharedPreferences', () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final client = ApiClient(prefs: prefs);

      client.updateBaseUrl('https://api.stockpilot.ai/v1');

      expect(client.dio.options.baseUrl, 'https://api.stockpilot.ai/v1');
      expect(ApiConfig.baseUrl, 'https://api.stockpilot.ai/v1');
      expect(prefs.getString(ApiConfig.keyCustomBaseUrl), 'https://api.stockpilot.ai/v1');

      // Reset
      ApiConfig.resetCustomBaseUrl();
    });
  });

  group('WarehouseTaskModel Tests', () {
    test('Task completion and type parsing', () {
      final json = {
        'id': 'tsk_001',
        'type': 'cycle_count',
        'title': 'Audit Bay 4',
        'description': 'Count vaccines in bay 4',
        'warehouse_id': 'WH-CENTRAL-01',
        'status': 'completed',
        'priority': 'high',
        'created_at': '2026-10-24T10:00:00',
      };

      final task = WarehouseTaskModel.fromJson(json);
      expect(task.type, TaskType.cycleCount);
      expect(task.isCompleted, true);
      expect(task.warehouseId, 'WH-CENTRAL-01');
    });
  });
}
