import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../data/models/batch_model.dart';
import '../../../data/models/inventory_model.dart';
import '../../../data/repositories/inventory_repository.dart';
import '../../../data/services/local_storage_service.dart';
import '../../auth/providers/auth_provider.dart';

final localStorageProvider = Provider<LocalStorageService>((ref) {
  final prefs = ref.watch(sharedPreferencesProvider);
  return LocalStorageService(prefs: prefs);
});

final inventoryRepositoryProvider = Provider<InventoryRepository>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  final localStorage = ref.watch(localStorageProvider);
  return InventoryRepository(apiClient: apiClient, localStorage: localStorage);
});

final inventoryListProvider = FutureProvider<List<InventoryItemModel>>((ref) async {
  final repo = ref.watch(inventoryRepositoryProvider);
  final auth = ref.watch(authStateProvider).value;
  final whId = auth?.warehouseId ?? 'wh_chicago_01';
  return repo.getInventory(warehouseId: whId);
});

final batchesListProvider = FutureProvider<List<InventoryBatchModel>>((ref) async {
  final repo = ref.watch(inventoryRepositoryProvider);
  final auth = ref.watch(authStateProvider).value;
  final whId = auth?.warehouseId ?? 'wh_chicago_01';
  return repo.getBatches(warehouseId: whId);
});

final expiringBatchesProvider = FutureProvider<List<InventoryBatchModel>>((ref) async {
  final batches = await ref.watch(batchesListProvider.future);
  return batches.where((b) => b.isExpiringSoon).toList();
});

final pendingSyncCountProvider = StateProvider<int>((ref) {
  final local = ref.watch(localStorageProvider);
  return local.getPendingQueue().length;
});
