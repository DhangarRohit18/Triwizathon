class IoTDeviceModel {
  final String deviceId;
  final String warehouseId;
  final String warehouseName;
  final String storageZone;
  final String deviceName;
  final String macAddress;
  final bool isOnline;
  final double currentTemp;
  final double currentHumidity;
  final double tempMinThreshold;
  final double tempMaxThreshold;
  final double humidityMaxThreshold;
  final int batteryPercent;

  IoTDeviceModel({
    required this.deviceId,
    required this.warehouseId,
    required this.warehouseName,
    this.storageZone = 'Storage Zone A',
    this.deviceName = 'IoT Sentinel',
    this.macAddress = '',
    required this.isOnline,
    required this.currentTemp,
    required this.currentHumidity,
    this.tempMinThreshold = 2.0,
    this.tempMaxThreshold = 8.0,
    this.humidityMaxThreshold = 65.0,
    this.batteryPercent = 94,
    double? temperature,
    double? humidity,
    double? minTemp,
    double? maxTemp,
    int? batteryLevel,
    String? locationDescription,
    String? lastHeartbeat,
  });

  double get temperature => currentTemp;
  double get humidity => currentHumidity;
  double get minTemp => tempMinThreshold;
  double get maxTemp => tempMaxThreshold;
  int get batteryLevel => batteryPercent;
  String get locationDescription => storageZone;
  bool get isTempNormal => currentTemp >= tempMinThreshold && currentTemp <= tempMaxThreshold;
  bool get isBreached => !isTempNormal;

  IoTDeviceModel copyWith({
    String? deviceId,
    String? warehouseId,
    String? warehouseName,
    String? storageZone,
    String? deviceName,
    String? macAddress,
    bool? isOnline,
    double? currentTemp,
    double? currentHumidity,
    double? tempMinThreshold,
    double? tempMaxThreshold,
    double? humidityMaxThreshold,
    int? batteryPercent,
    double? temperature,
    double? humidity,
    double? minTemp,
    double? maxTemp,
    int? batteryLevel,
    String? locationDescription,
    String? lastHeartbeat,
  }) {
    return IoTDeviceModel(
      deviceId: deviceId ?? this.deviceId,
      warehouseId: warehouseId ?? this.warehouseId,
      warehouseName: warehouseName ?? this.warehouseName,
      storageZone: locationDescription ?? storageZone ?? this.storageZone,
      deviceName: deviceName ?? this.deviceName,
      macAddress: macAddress ?? this.macAddress,
      isOnline: isOnline ?? this.isOnline,
      currentTemp: temperature ?? currentTemp ?? this.currentTemp,
      currentHumidity: humidity ?? currentHumidity ?? this.currentHumidity,
      tempMinThreshold: minTemp ?? tempMinThreshold ?? this.tempMinThreshold,
      tempMaxThreshold: maxTemp ?? tempMaxThreshold ?? this.tempMaxThreshold,
      humidityMaxThreshold: humidityMaxThreshold ?? this.humidityMaxThreshold,
      batteryPercent: batteryLevel ?? batteryPercent ?? this.batteryPercent,
    );
  }

  factory IoTDeviceModel.fromJson(Map<String, dynamic> json) {
    return IoTDeviceModel(
      deviceId: json['device_id'] ?? '',
      warehouseId: json['warehouse_id'] ?? '',
      warehouseName: json['warehouse_name'] ?? 'Warehouse',
      storageZone: json['storage_zone'] ?? json['location_description'] ?? 'Storage Zone',
      deviceName: json['device_name'] ?? 'IoT Sentinel',
      macAddress: json['mac_address'] ?? '',
      isOnline: json['is_online'] ?? true,
      currentTemp: (json['current_temp'] as num?)?.toDouble() ?? (json['temperature'] as num?)?.toDouble() ?? 0.0,
      currentHumidity: (json['current_humidity'] as num?)?.toDouble() ?? (json['humidity'] as num?)?.toDouble() ?? 0.0,
      tempMinThreshold: (json['temp_min_threshold'] as num?)?.toDouble() ?? (json['min_temp'] as num?)?.toDouble() ?? 2.0,
      tempMaxThreshold: (json['temp_max_threshold'] as num?)?.toDouble() ?? (json['max_temp'] as num?)?.toDouble() ?? 8.0,
      humidityMaxThreshold: (json['humidity_max_threshold'] as num?)?.toDouble() ?? 65.0,
      batteryPercent: json['battery_level'] ?? json['battery_percent'] ?? 94,
    );
  }
}

class IoTAlertModel {
  final String id;
  final String deviceId;
  final String alertType;
  final String severity; // critical, warning, info
  final String message;
  final double readingValue;
  final double thresholdValue;
  final String timestamp;
  final bool acknowledged;
  final String? acknowledgedBy;

  IoTAlertModel({
    required this.id,
    required this.deviceId,
    required this.alertType,
    required this.severity,
    required this.message,
    required this.readingValue,
    required this.thresholdValue,
    required this.timestamp,
    required this.acknowledged,
    this.acknowledgedBy,
  });

  bool get isCritical => severity.toLowerCase() == 'critical';

  factory IoTAlertModel.fromJson(Map<String, dynamic> json) {
    return IoTAlertModel(
      id: json['id'] ?? '',
      deviceId: json['device_id'] ?? '',
      alertType: json['alert_type'] ?? 'temp_excursion',
      severity: json['severity'] ?? 'warning',
      message: json['message'] ?? 'Alert triggered',
      readingValue: (json['reading_value'] as num?)?.toDouble() ?? 0.0,
      thresholdValue: (json['threshold_value'] as num?)?.toDouble() ?? 0.0,
      timestamp: json['timestamp'] ?? '',
      acknowledged: json['acknowledged'] ?? false,
      acknowledgedBy: json['acknowledged_by'],
    );
  }
}
