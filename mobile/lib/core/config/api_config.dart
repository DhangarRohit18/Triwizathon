import 'dart:io';
import 'package:flutter/foundation.dart';

class ApiConfig {
  static const String defaultOrgId = 'org_triwiz_01';

  static String? _customUrl;

  static String get baseUrl => _customUrl ?? defaultBaseUrl;

  /// Validates and normalizes an API URL before saving.
  /// Throws [FormatException] if URL is malformed, uses unsupported scheme,
  /// contains embedded credentials, or uses HTTP for a remote production host.
  static String validateAndNormalizeUrl(String rawUrl) {
    final trimmed = rawUrl.trim();
    if (trimmed.isEmpty) {
      throw const FormatException('API URL cannot be empty.');
    }

    final uri = Uri.tryParse(trimmed);
    if (uri == null || !uri.hasScheme || !uri.hasAuthority) {
      throw const FormatException('Invalid URL format. Please include host and port (e.g., http://10.0.2.2:8000/api/v1).');
    }

    if (uri.scheme != 'http' && uri.scheme != 'https') {
      throw const FormatException('Unsupported URL scheme. Only HTTP and HTTPS are permitted.');
    }

    if (uri.userInfo.isNotEmpty) {
      throw const FormatException('Embedded credentials in API URLs are strictly prohibited.');
    }

    // Require HTTPS for non-local production hosts
    final host = uri.host.toLowerCase();
    final isLocal = host == 'localhost' ||
        host == '127.0.0.1' ||
        host == '10.0.2.2' ||
        host.startsWith('192.168.') ||
        host.startsWith('10.') ||
        host.endsWith('.local');

    if (!isLocal && uri.scheme != 'https') {
      throw const FormatException('Deployed remote environments require HTTPS for data security.');
    }

    // Remove any trailing slashes for clean path joining
    return trimmed.replaceAll(RegExp(r'/+$'), '');
  }

  static void setCustomBaseUrl(String url) {
    _customUrl = validateAndNormalizeUrl(url);
  }

  static void resetCustomBaseUrl() {
    _customUrl = null;
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
