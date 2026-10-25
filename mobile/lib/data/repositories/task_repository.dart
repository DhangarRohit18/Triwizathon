import '../../core/networking/api_client.dart';
import '../models/task_model.dart';

class TaskRepository {
  final ApiClient apiClient;

  TaskRepository({required this.apiClient});

  Future<List<WarehouseTaskModel>> getTasks({String? warehouseId}) async {
    final query = warehouseId != null ? {'warehouse_id': warehouseId} : null;
    final res = await apiClient.get<List<dynamic>>('/tasks', queryParameters: query);
    final data = res.data ?? [];
    return data.map((json) => WarehouseTaskModel.fromJson(json as Map<String, dynamic>)).toList();
  }

  Future<void> completeTask(String taskId, {String? notes}) async {
    await apiClient.post('/tasks/$taskId/complete', data: {
      'notes': notes ?? 'Completed on mobile companion',
    });
  }
}
