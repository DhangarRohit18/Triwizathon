import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stockpilot_mobile/core/errors/app_exception.dart';
import 'package:stockpilot_mobile/core/networking/api_client.dart';
import 'package:stockpilot_mobile/data/repositories/inventory_repository.dart';
import 'package:stockpilot_mobile/data/services/local_storage_service.dart';

// Fake ApiClient that simulates server responses or exceptions
class MockApiClient extends ApiClient {
  MockApiClient({required super.prefs});

  Map<String, dynamic>? mockResponseData;
  AppException? exceptionToThrow;
  String? lastPath;
  dynamic lastData;

  @override
  Future<Response<T>> post<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    lastPath = path;
    lastData = data;

    if (exceptionToThrow != null) {
      throw exceptionToThrow!;
    }

    return Response<T>(
      requestOptions: RequestOptions(path: path),
      data: (mockResponseData ?? {
        'status': 'success',
        'movement': {'id': 'tx_mock_ledger_001'},
        'transaction_id': 'TX-MOCK-999',
        'variance': 0,
      }) as T,
      statusCode: 200,
    );
  }

  @override
  Future<Response<T>> get<T>(
    String path, {
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    lastPath = path;

    if (exceptionToThrow != null) {
      throw exceptionToThrow!;
    }

    if (path == '/products/resolve-qr') {
      return Response<T>(
        requestOptions: RequestOptions(path: path),
        data: {
          'resolved_type': 'batch',
          'product_id': 'prd_vax_01',
          'product_name': 'Comirnaty Ultra-Cold Vaccine',
          'sku': 'PRD-VAX-01',
          'category': 'Vaccines & Biologics',
          'warehouse_id': 'wh_chicago_01',
          'batch_number': 'BN-VX-2026-A1',
          'batch_id': 'bat_vax_chi_01',
          'current_stock': 850,
          'total_available': 2200,
        } as T,
        statusCode: 200,
      );
    }

    return Response<T>(
      requestOptions: RequestOptions(path: path),
      data: [] as T,
      statusCode: 200,
    );
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late SharedPreferences prefs;
  late LocalStorageService localStorage;
  late MockApiClient mockApi;
  late InventoryRepository repo;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    prefs = await SharedPreferences.getInstance();
    localStorage = LocalStorageService(prefs: prefs);
    mockApi = MockApiClient(prefs: prefs);
    repo = InventoryRepository(apiClient: mockApi, localStorage: localStorage);
  });

  group('authoritative QR & Inventory Workflow Tests', () {
    test('QR code resolution validates product and batch metadata without exposing secrets', () async {
      final res = await repo.resolveQrCode('STOCKPILOT://BATCH/BN-VX-2026-A1/WH/wh_chicago_01');

      expect(res['resolved_type'], 'batch');
      expect(res['product_id'], 'prd_vax_01');
      expect(res['sku'], 'PRD-VAX-01');
      expect(res['batch_number'], 'BN-VX-2026-A1');
      // Guarantee no secrets/tokens in returned payload
      expect(res.containsKey('password'), false);
      expect(res.containsKey('secret_key'), false);
      expect(res.containsKey('api_key'), false);
    });

    test('Receive stock submits idempotent request and returns server-confirmed outcome', () async {
      mockApi.mockResponseData = {
        'status': 'committed',
        'movement': {'id': 'mov_rec_8812'},
        'batch': {'id': 'bat_rec_01', 'quantity': 500},
      };

      final result = await repo.receiveStock(
        warehouseId: 'wh_chicago_01',
        productId: 'prd_vax_01',
        batchNumber: 'BN-VX-2026-A1',
        quantity: 500,
        expiryDate: '2026-12-31',
        idempotencyKey: 'IDEMP-REC-001',
      );

      expect(result.isSuccess, true);
      expect(result.isOfflineDraft, false);
      expect(result.status, 'COMMITTED');
      expect(result.transactionId, 'mov_rec_8812');
      expect(result.correlationId, 'IDEMP-REC-001');
      expect(mockApi.lastPath, '/inventory/receive');
      expect(mockApi.lastData['correlation_id'], 'IDEMP-REC-001');
    });

    test('Dispatch stock verifies proposed operation and returns ledger commitment', () async {
      mockApi.mockResponseData = {
        'status': 'committed',
        'movement': {'id': 'mov_disp_9921'},
      };

      final result = await repo.dispatchStock(
        warehouseId: 'wh_chicago_01',
        productId: 'prd_vax_01',
        destinationHospitalId: 'HOSP-METRO-01',
        quantity: 50,
        batchNumber: 'BN-VX-2026-A1',
        idempotencyKey: 'IDEMP-DISP-001',
      );

      expect(result.isSuccess, true);
      expect(result.isOfflineDraft, false);
      expect(result.status, 'COMMITTED');
      expect(result.transactionId, 'mov_disp_9921');
      expect(mockApi.lastPath, '/inventory/dispatch');
    });

    test('Physical cycle count records variance and ledger audit trail', () async {
      mockApi.mockResponseData = {
        'status': 'committed',
        'movement': {'id': 'mov_cnt_3311'},
        'variance': -5,
      };

      final result = await repo.cycleCount(
        warehouseId: 'wh_chicago_01',
        productId: 'prd_vax_01',
        batchId: 'bat_vax_chi_01',
        countedQuantity: 845,
        idempotencyKey: 'IDEMP-CNT-001',
      );

      expect(result.isSuccess, true);
      expect(result.status, 'COMMITTED');
      expect(result.message.contains('-5'), true);
      expect(mockApi.lastPath, '/inventory/cycle-count');
    });

    test('Transfer acknowledgment updates status and returns confirmed receipt', () async {
      mockApi.mockResponseData = {
        'success': true,
        'transfer': {'id': 'trf_001_chi_ny', 'status': 'received'},
      };

      final result = await repo.receiveTransfer(
        transferId: 'trf_001_chi_ny',
        condition: 'intact',
        damagedQuantity: 0,
      );

      expect(result.isSuccess, true);
      expect(result.status, 'COMMITTED');
      expect(result.transactionId, 'trf_001_chi_ny');
      expect(mockApi.lastPath, '/transfers/receive');
    });

    test('Network failure saves safe offline draft and is NOT presented as committed', () async {
      mockApi.exceptionToThrow = NetworkException('No connection to server');

      final result = await repo.receiveStock(
        warehouseId: 'wh_chicago_01',
        productId: 'prd_vax_01',
        batchNumber: 'BN-OFFLINE-01',
        quantity: 120,
        expiryDate: '2026-12-31',
        idempotencyKey: 'IDEMP-OFFLINE-01',
      );

      // Must be clearly identified as an offline draft, NEVER committed
      expect(result.isSuccess, true);
      expect(result.isOfflineDraft, true);
      expect(result.status, 'OFFLINE_DRAFT');
      expect(result.isCommitted, false);

      // Verify draft exists in local storage sync queue
      final queue = localStorage.getPendingQueue();
      expect(queue.length, 1);
      expect(queue.first['correlation_id'], 'IDEMP-OFFLINE-01');
      expect(queue.first['is_offline_draft'], true);
    });

    test('Backend rejection (insufficient stock) throws ValidationException and does NOT create false draft', () async {
      mockApi.exceptionToThrow = ValidationException('Insufficient available stock. Requested 500, but only 200 available.');

      expect(
        () async => await repo.dispatchStock(
          warehouseId: 'wh_chicago_01',
          productId: 'prd_vax_01',
          quantity: 500,
          idempotencyKey: 'IDEMP-REJ-01',
        ),
        throwsA(isA<ValidationException>()),
      );

      // Must NOT queue rejected operation as a valid offline draft
      final queue = localStorage.getPendingQueue();
      expect(queue.length, 0);
    });
  });
}
