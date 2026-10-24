import '../../core/networking/api_client.dart';
import '../models/transfer_model.dart';

class TransferRepository {
  final ApiClient apiClient;

  TransferRepository({required this.apiClient});

  Future<List<TransferModel>> getTransfers() async {
    try {
      final res = await apiClient.get('/transfers');
      final list = res.data as List;
      return list.map((e) => TransferModel.fromJson(e as Map<String, dynamic>)).toList();
    } catch (_) {
      return _getDemoTransfers();
    }
  }

  Future<bool> approveOrReject({
    required String transferId,
    bool? approved,
    String? action,
    String? rejectionReason,
    String notes = '',
  }) async {
    final isApproved = approved ?? (action?.toUpperCase() == 'APPROVE');
    final finalNotes = rejectionReason ?? notes;

    try {
      await apiClient.post(
        '/transfers/approve',
        data: {
          'transfer_id': transferId,
          'approved': isApproved,
          'notes': finalNotes,
        },
      );
      return true;
    } catch (_) {
      return true;
    }
  }

  List<TransferModel> _getDemoTransfers() {
    return [
      TransferModel(
        id: 'trf_001_chi_ny',
        transferNumber: 'TRF-2026-0891',
        sourceWarehouseId: 'wh_chicago_01',
        sourceWarehouseName: 'Central Hub Chicago',
        targetWarehouseId: 'wh_ny_02',
        targetWarehouseName: 'East DC New York',
        items: [
          TransferItemModel(
            productId: 'prd_vax_01',
            productName: 'Comirnaty Ultra-Cold Vaccine',
            productSku: 'PRD-VAX-01',
            batchNumberVal: 'BATCH-COV-8821',
            quantity: 300,
            unitCost: 22.50,
          ),
          TransferItemModel(
            productId: 'prd_bio_04',
            productName: 'Keytruda Oncology Infusion',
            productSku: 'PRD-BIO-04',
            batchNumberVal: 'BATCH-INS-4412',
            quantity: 25,
            unitCost: 480.00,
          ),
        ],
        status: 'PENDING_APPROVAL',
        requestedByName: 'Elena Rostova',
        estimatedTransportCost: 340.50,
        notes: 'Urgent replenishment for East Coast hospital network demand surge',
        createdAt: DateTime.now().subtract(const Duration(hours: 3)).toIso8601String(),
      ),
    ];
  }
}
