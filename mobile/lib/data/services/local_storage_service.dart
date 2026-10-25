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

  // ---------------------------------------------------------------------------
  // RuralReach Mode Snapshot & Offline Cache Persistence
  // ---------------------------------------------------------------------------
  static const String keyRuralReachSnapshot = 'ruralreach_snapshot';
  static const String keyRuralReachCatalogue = 'ruralreach_catalogue';
  static const String keyRuralReachInventory = 'ruralreach_inventory';
  static const String keyRuralReachBatches = 'ruralreach_batches';
  static const String keyRuralReachRecommendations = 'ruralreach_recommendations';

  Future<void> saveRuralReachSnapshot(Map<String, dynamic> snapshot) async {
    await prefs.setString(keyRuralReachSnapshot, jsonEncode(snapshot));
    if (snapshot['products'] != null) {
      await prefs.setString(keyRuralReachCatalogue, jsonEncode(snapshot['products']));
    }
    if (snapshot['inventory'] != null) {
      await prefs.setString(keyRuralReachInventory, jsonEncode(snapshot['inventory']));
    }
    if (snapshot['batches'] != null) {
      await prefs.setString(keyRuralReachBatches, jsonEncode(snapshot['batches']));
    }
    if (snapshot['recommendations'] != null) {
      await prefs.setString(keyRuralReachRecommendations, jsonEncode(snapshot['recommendations']));
    }
  }

  Map<String, dynamic>? getRuralReachSnapshot() {
    final raw = prefs.getString(keyRuralReachSnapshot);
    if (raw == null || raw.isEmpty) return null;
    try {
      return jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }

  List<Map<String, dynamic>> getCachedRuralReachCatalogue() {
    final raw = prefs.getString(keyRuralReachCatalogue);
    if (raw == null || raw.isEmpty) return [];
    try {
      final list = jsonDecode(raw) as List;
      return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } catch (_) {
      return [];
    }
  }

  List<Map<String, dynamic>> getCachedRuralReachInventory() {
    final raw = prefs.getString(keyRuralReachInventory);
    if (raw == null || raw.isEmpty) return [];
    try {
      final list = jsonDecode(raw) as List;
      return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } catch (_) {
      return [];
    }
  }

  List<Map<String, dynamic>> getCachedRuralReachBatches() {
    final raw = prefs.getString(keyRuralReachBatches);
    if (raw == null || raw.isEmpty) return [];
    try {
      final list = jsonDecode(raw) as List;
      return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } catch (_) {
      return [];
    }
  }
}

