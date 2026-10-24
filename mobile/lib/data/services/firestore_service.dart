import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/inventory_model.dart';
import '../models/batch_model.dart';
import '../models/iot_model.dart';
import '../models/transfer_model.dart';

class FirestoreService {
  final FirebaseFirestore _firestore;
  static const String defaultOrgId = 'org_triwiz_01';

  FirestoreService({FirebaseFirestore? firestore})
      : _firestore = firestore ?? FirebaseFirestore.instance;

  /// Real-time stream of inventory stock aggregates for assigned warehouse
  Stream<List<InventoryItemModel>> streamInventory({String? warehouseId}) {
    try {
      Query<Map<String, dynamic>> query = _firestore
          .collection('inventory')
          .where('org_id', isEqualTo: defaultOrgId);

      if (warehouseId != null && warehouseId != 'all') {
        query = query.where('warehouse_id', isEqualTo: warehouseId);
      }

      return query.snapshots().map((snapshot) {
        return snapshot.docs.map((doc) {
          final data = doc.data();
          return InventoryItemModel.fromJson({'id': doc.id, ...data});
        }).toList();
      });
    } catch (e) {
      // In offline or non-credentialed test environments, return empty stream
      return const Stream.empty();
    }
  }

  /// Real-time stream of FEFO batches
  Stream<List<InventoryBatchModel>> streamBatches({String? warehouseId}) {
    try {
      Query<Map<String, dynamic>> query = _firestore
          .collection('inventory_batches')
          .where('org_id', isEqualTo: defaultOrgId);

      if (warehouseId != null && warehouseId != 'all') {
        query = query.where('warehouse_id', isEqualTo: warehouseId);
      }

      return query.snapshots().map((snapshot) {
        return snapshot.docs.map((doc) {
          final data = doc.data();
          return InventoryBatchModel.fromJson({'id': doc.id, ...data});
        }).toList();
      });
    } catch (e) {
      return const Stream.empty();
    }
  }

  /// Real-time stream of active cold-chain IoT alerts
  Stream<List<IoTAlertModel>> streamAlerts() {
    try {
      return _firestore
          .collection('alerts')
          .where('org_id', isEqualTo: defaultOrgId)
          .orderBy('timestamp', descending: true)
          .snapshots()
          .map((snapshot) {
        return snapshot.docs.map((doc) {
          final data = doc.data();
          return IoTAlertModel.fromJson({'id': doc.id, ...data});
        }).toList();
      });
    } catch (e) {
      return const Stream.empty();
    }
  }

  /// Real-time stream of inter-warehouse transfers
  Stream<List<TransferModel>> streamTransfers() {
    try {
      return _firestore
          .collection('transfers')
          .where('org_id', isEqualTo: defaultOrgId)
          .orderBy('created_at', descending: true)
          .snapshots()
          .map((snapshot) {
        return snapshot.docs.map((doc) {
          final data = doc.data();
          return TransferModel.fromJson({'id': doc.id, ...data});
        }).toList();
      });
    } catch (e) {
      return const Stream.empty();
    }
  }
}
