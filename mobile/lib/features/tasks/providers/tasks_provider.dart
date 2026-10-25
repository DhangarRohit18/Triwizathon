import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../data/models/task_model.dart';
import '../../../data/repositories/task_repository.dart';
import '../../auth/providers/auth_provider.dart';

final taskRepositoryProvider = Provider<TaskRepository>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  return TaskRepository(apiClient: apiClient);
});

final tasksListProvider = FutureProvider<List<WarehouseTaskModel>>((ref) async {
  final repo = ref.watch(taskRepositoryProvider);
  final auth = ref.watch(authNotifierProvider).user;
  return repo.getTasks(warehouseId: auth?.warehouseId);
});
