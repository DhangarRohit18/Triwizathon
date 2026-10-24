import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../data/models/recommendation_model.dart';
import '../../../data/models/transfer_model.dart';
import '../../../data/repositories/optimization_repository.dart';
import '../../../data/repositories/transfer_repository.dart';
import '../../auth/providers/auth_provider.dart';

final transferRepositoryProvider = Provider<TransferRepository>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  return TransferRepository(apiClient: apiClient);
});

final optimizationRepositoryProvider = Provider<OptimizationRepository>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  return OptimizationRepository(apiClient: apiClient);
});

final transfersListProvider = FutureProvider<List<TransferModel>>((ref) async {
  final repo = ref.watch(transferRepositoryProvider);
  return repo.getTransfers();
});

final pendingTransfersProvider = FutureProvider<List<TransferModel>>((ref) async {
  final transfers = await ref.watch(transfersListProvider.future);
  return transfers.where((t) => t.isPending).toList();
});

final recommendationsListProvider = FutureProvider<List<AllocationRecommendationModel>>((ref) async {
  final repo = ref.watch(optimizationRepositoryProvider);
  return repo.getLatestRecommendations();
});

final recommendationsProvider = recommendationsListProvider;
