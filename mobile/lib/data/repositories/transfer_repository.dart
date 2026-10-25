import '../../core/networking/api_client.dart';
import '../models/transfer_model.dart';

class TransferRepository {
  final ApiClient apiClient;

  TransferRepository({required this.apiClient});

  Future<List<TransferModel>> getTransfers() async {
    final res = await apiClient.get('/transfers');
    final list = res.data as List;
    return list.map((e) => TransferModel.fromJson(e as Map<String, dynamic>)).toList();
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

    final res = await apiClient.post(
      '/transfers/approve',
      data: {
        'transfer_id': transferId,
        'approved': isApproved,
        'notes': finalNotes,
      },
    );
    return res.statusCode == 200 || res.statusCode == 201;
  }

  Future<bool> createTransferFromRecommendation({
    required String runId,
    required String recommendationId,
    String notes = '',
  }) async {
    final res = await apiClient.post(
      '/optimization/create-transfer',
      data: {
        'run_id': runId,
        'recommendation_id': recommendationId,
        'notes': notes,
      },
    );
    return res.statusCode == 200 || res.statusCode == 201;
  }
}

