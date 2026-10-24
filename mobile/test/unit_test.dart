import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stockpilot_mobile/data/models/batch_model.dart';
import 'package:stockpilot_mobile/data/models/inventory_model.dart';
import 'package:stockpilot_mobile/data/models/iot_model.dart';
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
  });
}
