import '../../core/networking/api_client.dart';
import '../models/iot_model.dart';

class IoTRepository {
  final ApiClient apiClient;

  IoTRepository({required this.apiClient});

  Future<List<IoTDeviceModel>> getDevices() async {
    final res = await apiClient.get('/iot/devices');
    final list = res.data as List;
    return list.map((e) => IoTDeviceModel.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<List<IoTAlertModel>> getAlerts() async {
    final res = await apiClient.get('/iot/alerts');
    final list = res.data as List;
    return list.map((e) => IoTAlertModel.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<bool> acknowledgeAlert(String alertId) async {
    final res = await apiClient.post('/iot/alerts/$alertId/acknowledge');
    return res.statusCode == 200 || res.statusCode == 201;
  }
}
