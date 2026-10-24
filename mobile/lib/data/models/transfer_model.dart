class TransferItemModel {
  final String productId;
  final String productName;
  final String productSku;
  final String? batchNumberVal;
  final int quantity;
  final double unitCost;

  TransferItemModel({
    required this.productId,
    required this.productName,
    required this.productSku,
    this.batchNumberVal,
    required this.quantity,
    this.unitCost = 0.0,
  });

  String get batchNumber => batchNumberVal ?? 'BATCH-DEFAULT';

  factory TransferItemModel.fromJson(Map<String, dynamic> json) {
    return TransferItemModel(
      productId: json['product_id'] ?? '',
      productName: json['product_name'] ?? 'Product',
      productSku: json['product_sku'] ?? '',
      batchNumberVal: json['batch_number'],
      quantity: json['quantity'] ?? 0,
      unitCost: (json['unit_cost'] as num?)?.toDouble() ?? 0.0,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'product_id': productId,
      'product_name': productName,
      'product_sku': productSku,
      'batch_number': batchNumber,
      'quantity': quantity,
      'unit_cost': unitCost,
    };
  }
}

class TransferModel {
  final String id;
  final String transferNumber;
  final String sourceWarehouseId;
  final String sourceWarehouseName;
  final String targetWarehouseId;
  final String targetWarehouseName;
  final List<TransferItemModel> items;
  final String status; // pending, approved, in_transit, received, rejected
  final String requestedByName;
  final String? approvedByName;
  final double estimatedTransportCost;
  final String? notes;
  final String createdAt;

  TransferModel({
    required this.id,
    required this.transferNumber,
    required this.sourceWarehouseId,
    required this.sourceWarehouseName,
    required this.targetWarehouseId,
    required this.targetWarehouseName,
    required this.items,
    required this.status,
    required this.requestedByName,
    this.approvedByName,
    this.estimatedTransportCost = 0.0,
    this.notes,
    required this.createdAt,
  });

  String get originWarehouseName => sourceWarehouseName;
  String get destinationWarehouseName => targetWarehouseName;
  String? get rejectionReason => notes;

  bool get isPending => status.toLowerCase().contains('pending');
  bool get isInTransit => status.toLowerCase().contains('transit');

  factory TransferModel.fromJson(Map<String, dynamic> json) {
    final rawItems = json['items'] as List? ?? [];
    return TransferModel(
      id: json['id'] ?? '',
      transferNumber: json['transfer_number'] ?? 'TRF-UNKNOWN',
      sourceWarehouseId: json['source_warehouse_id'] ?? json['origin_warehouse_id'] ?? '',
      sourceWarehouseName: json['source_warehouse_name'] ?? json['origin_warehouse_name'] ?? 'Source Hub',
      targetWarehouseId: json['target_warehouse_id'] ?? json['destination_warehouse_id'] ?? '',
      targetWarehouseName: json['target_warehouse_name'] ?? json['destination_warehouse_name'] ?? 'Target Hub',
      items: rawItems.map((i) => TransferItemModel.fromJson(i as Map<String, dynamic>)).toList(),
      status: json['status'] ?? 'pending',
      requestedByName: json['requested_by_name'] ?? 'Staff',
      approvedByName: json['approved_by_name'],
      estimatedTransportCost: (json['estimated_transport_cost'] as num?)?.toDouble() ?? 0.0,
      notes: json['notes'] ?? json['rejection_reason'],
      createdAt: json['created_at'] ?? '',
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'transfer_number': transferNumber,
      'source_warehouse_id': sourceWarehouseId,
      'source_warehouse_name': sourceWarehouseName,
      'target_warehouse_id': targetWarehouseId,
      'target_warehouse_name': targetWarehouseName,
      'items': items.map((i) => i.toJson()).toList(),
      'status': status,
      'requested_by_name': requestedByName,
      'approved_by_name': approvedByName,
      'estimated_transport_cost': estimatedTransportCost,
      'notes': notes,
      'created_at': createdAt,
    };
  }
}
