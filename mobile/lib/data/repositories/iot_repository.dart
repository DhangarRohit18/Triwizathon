import '../../core/networking/api_client.dart';
import '../models/iot_model.dart';

class IoTRepository {
  final ApiClient apiClient;

  IoTRepository({required this.apiClient});

  Future<List<IoTDeviceModel>> getDevices() async {
    try {
      final res = await apiClient.get('/iot/devices');
      final list = res.data as List;
      return list.map((e) => IoTDeviceModel.fromJson(e as Map<String, dynamic>)).toList();
    } catch (_) {
      return _getDemoDevices();
    }
  }

  Future<List<IoTAlertModel>> getAlerts() async {
    try {
      final res = await apiClient.get('/iot/alerts');
      final list = res.data as List;
      return list.map((e) => IoTAlertModel.fromJson(e as Map<String, dynamic>)).toList();
    } catch (_) {
      return _getDemoAlerts();
    }
  }

  Future<bool> acknowledgeAlert(String alertId) async {
    final res = await apiClient.post('/iot/alerts/$alertId/acknowledge');
    return res.statusCode == 200 || res.statusCode == 201;
  }

  List<IoTDeviceModel> _getDemoDevices() {
    return [
      IoTDeviceModel(
        deviceId: 'ESP32-COLD-CHI-01',
        warehouseId: 'wh_chicago_01',
        warehouseName: 'Central Hub Chicago',
        storageZone: 'Cold Room A (Vaccines & Insulin)',
        deviceName: 'ESP32 Cold Sentinel A1',
        macAddress: '24:6F:28:AB:12:01',
        isOnline: true,
        currentTemp: 4.2,
        currentHumidity: 48.5,
        tempMinThreshold: 2.0,
        tempMaxThreshold: 8.0,
        humidityMaxThreshold: 60.0,
      ),
      IoTDeviceModel(
        deviceId: 'ESP32-DEEP-CHI-02',
        warehouseId: 'wh_chicago_01',
        warehouseName: 'Central Hub Chicago',
        storageZone: 'Ultra-Low Vault (-80C)',
        deviceName: 'ESP32 Cryo Sentinel B2',
        macAddress: '24:6F:28:AB:12:02',
        isOnline: true,
        currentTemp: -22.4,
        currentHumidity: 18.2,
        tempMinThreshold: -80.0,
        tempMaxThreshold: -20.0,
        humidityMaxThreshold: 30.0,
      ),
    ];
  }

  List<IoTAlertModel> _getDemoAlerts() {
    return [
      IoTAlertModel(
        id: 'alt_demo_01',
        deviceId: 'ESP32-COLD-CHI-01',
        alertType: 'temp_excursion',
        severity: 'critical',
        message: 'Temperature spike detected in Cold Room A: 8.4°C (Limit: 8.0°C)',
        readingValue: 8.4,
        thresholdValue: 8.0,
        timestamp: DateTime.now().subtract(const Duration(minutes: 24)).toIso8601String(),
        acknowledged: false,
      ),
    ];
  }
}
