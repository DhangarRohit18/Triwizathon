import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/config/api_config.dart';

class LocalStorageService {
  final SharedPreferences prefs;

  LocalStorageService({required this.prefs});

  List<Map<String, dynamic>> getPendingQueue() {
    final raw = prefs.getString(ApiConfig.keyPendingSyncQueue);
    if (raw == null || raw.isEmpty) return [];
    try {
      final list = jsonDecode(raw) as List;
      return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> queueOperation(Map<String, dynamic> operation) async {
    final queue = getPendingQueue();
    queue.add({
      ...operation,
      'queued_at': DateTime.now().toIso8601String(),
    });
    await prefs.setString(ApiConfig.keyPendingSyncQueue, jsonEncode(queue));
  }

  Future<void> removeOperation(String correlationId) async {
    final queue = getPendingQueue();
    queue.removeWhere((op) => op['correlation_id'] == correlationId);
    await prefs.setString(ApiConfig.keyPendingSyncQueue, jsonEncode(queue));
  }

  Future<void> clearQueue() async {
    await prefs.remove(ApiConfig.keyPendingSyncQueue);
  }

  // Static helpers for quick UI/test access
  static Future<List<Map<String, dynamic>>> getPendingSyncQueue() async {
    final sp = await SharedPreferences.getInstance();
    final raw = sp.getString(ApiConfig.keyPendingSyncQueue);
    if (raw == null || raw.isEmpty) return [];
    try {
      final list = jsonDecode(raw) as List;
      return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } catch (_) {
      return [];
    }
  }

  static Future<void> enqueuePendingSync({
    required String action,
    required Map<String, dynamic> payload,
    required String idempotencyKey,
  }) async {
    final sp = await SharedPreferences.getInstance();
    final raw = sp.getString(ApiConfig.keyPendingSyncQueue);
    List<Map<String, dynamic>> queue = [];
    if (raw != null && raw.isNotEmpty) {
      try {
        final list = jsonDecode(raw) as List;
        queue = list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
      } catch (_) {}
    }
    queue.add({
      'action': action,
      'payload': payload,
      'idempotency_key': idempotencyKey,
      'correlation_id': idempotencyKey,
      'timestamp': DateTime.now().toIso8601String(),
      'queued_at': DateTime.now().toIso8601String(),
    });
    await sp.setString(ApiConfig.keyPendingSyncQueue, jsonEncode(queue));
  }

  static Future<void> clearPendingSyncQueue() async {
    final sp = await SharedPreferences.getInstance();
    await sp.remove(ApiConfig.keyPendingSyncQueue);
  }
}
