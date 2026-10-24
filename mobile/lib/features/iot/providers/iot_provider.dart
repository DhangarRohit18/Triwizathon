import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../data/models/iot_model.dart';
import '../../../data/repositories/iot_repository.dart';
import '../../auth/providers/auth_provider.dart';

final iotRepositoryProvider = Provider<IoTRepository>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  return IoTRepository(apiClient: apiClient);
});

final iotDevicesProvider = FutureProvider<List<IoTDeviceModel>>((ref) async {
  final repo = ref.watch(iotRepositoryProvider);
  return repo.getDevices();
});

final iotAlertsProvider = FutureProvider<List<IoTAlertModel>>((ref) async {
  final repo = ref.watch(iotRepositoryProvider);
  return repo.getAlerts();
});
