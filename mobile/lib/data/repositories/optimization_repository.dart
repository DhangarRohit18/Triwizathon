import '../../core/networking/api_client.dart';
import '../models/recommendation_model.dart';

class OptimizationRepository {
  final ApiClient apiClient;

  OptimizationRepository({required this.apiClient});

  Future<List<AllocationRecommendationModel>> getLatestRecommendations() async {
    final res = await apiClient.get('/optimization/runs');
    final runs = res.data as List;
    if (runs.isNotEmpty) {
      final latest = runs[0] as Map<String, dynamic>;
      final recs = latest['recommendations'] as List? ?? [];
      return recs.map((e) => AllocationRecommendationModel.fromJson(e as Map<String, dynamic>)).toList();
    }
    return <AllocationRecommendationModel>[];
  }
}

