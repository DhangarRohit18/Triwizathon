import 'dart:io';
import 'package:flutter/foundation.dart';

class ApiConfig {
  static const String defaultOrgId = 'org_triwiz_01';

  static String? _customUrl;

  static String get baseUrl => _customUrl ?? defaultBaseUrl;

  static void setCustomBaseUrl(String url) {
    _customUrl = url;
  }

  // Automatically picks host loopback depending on Android Emulator vs Desktop/Web
  static String get defaultBaseUrl {
    if (_customUrl != null && _customUrl!.isNotEmpty) {
      return _customUrl!;
    }
    if (!kIsWeb && Platform.isAndroid) {
      // 10.0.2.2 points to host machine loopback inside default Android Emulator
      return 'http://10.0.2.2:8000/api/v1';
    }
    return 'http://127.0.0.1:8000/api/v1';
  }

  static const Duration connectTimeout = Duration(seconds: 10);
  static const Duration receiveTimeout = Duration(seconds: 15);

  // Storage Keys
  static const String keyAuthToken = 'stockpilot_auth_token';
  static const String keyUserRole = 'stockpilot_user_role';
  static const String keyWarehouseId = 'stockpilot_warehouse_id';
  static const String keyCustomBaseUrl = 'stockpilot_custom_base_url';
  static const String keyPendingSyncQueue = 'stockpilot_pending_sync_queue';
}
