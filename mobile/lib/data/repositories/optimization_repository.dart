import '../../core/networking/api_client.dart';
import '../models/recommendation_model.dart';

class OptimizationRepository {
  final ApiClient apiClient;

  OptimizationRepository({required this.apiClient});

  Future<List<AllocationRecommendationModel>> getLatestRecommendations() async {
    try {
      final res = await apiClient.get('/optimization/runs');
      final runs = res.data as List;
      if (runs.isNotEmpty) {
        final latest = runs[0] as Map<String, dynamic>;
        final recs = latest['recommendations'] as List? ?? [];
        return recs.map((e) => AllocationRecommendationModel.fromJson(e as Map<String, dynamic>)).toList();
      }
      return _getDemoRecommendations();
    } catch (_) {
      return _getDemoRecommendations();
    }
  }

  List<AllocationRecommendationModel> _getDemoRecommendations() {
    return [
      AllocationRecommendationModel(
        id: 'rec_01',
        productId: 'prd_vax_01',
        productSku: 'PRD-VAX-01',
        productName: 'Comirnaty Ultra-Cold Vaccine',
        sourceWarehouseId: 'wh_chicago_01',
        sourceWarehouseName: 'Central Hub Chicago',
        destinationId: 'dest_boston_01',
        destinationName: 'Boston Medical Center',
        allocatedQuantity: 180,
        requestedDemand: 180,
        unitTransportCost: 4.85,
        totalTransportCost: 873.0,
        estimatedDeliveryHours: 14.5,
        expiryRiskScore: 0.35,
        stockoutRiskAfter: 0.0,
        rationale: 'FEFO priority: allocates 35% near-expiry batch to eliminate spoilage risk. Optimal freight route.',
      ),
      AllocationRecommendationModel(
        id: 'rec_02',
        productId: 'prd_ins_02',
        productSku: 'PRD-INS-02',
        productName: 'Humalog Rapid-Acting Insulin',
        sourceWarehouseId: 'wh_chicago_01',
        sourceWarehouseName: 'Central Hub Chicago',
        destinationId: 'dest_detroit_03',
        destinationName: 'Detroit Metropolitan Hospital',
        allocatedQuantity: 250,
        requestedDemand: 250,
        unitTransportCost: 2.40,
        totalTransportCost: 600.0,
        estimatedDeliveryHours: 5.2,
        expiryRiskScore: 0.0,
        stockoutRiskAfter: 0.0,
        rationale: 'Lowest unit freight distance (380 km) with high fill-rate fulfillment.',
      ),
    ];
  }
}
