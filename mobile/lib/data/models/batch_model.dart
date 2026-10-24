class InventoryBatchModel {
  final String id;
  final String warehouseId;
  final String productId;
  final String productName;
  final String productSku;
  final String warehouseName;
  final String batchNumber;
  final String supplierReference;
  final String mfgDate;
  final String expiryDate;
  final int quantity;
  final int reservedQuantity;
  final int damagedQuantity;
  final double unitCost;
  final String storageBin;
  final String qrCodeId;
  final String status;

  InventoryBatchModel({
    required this.id,
    required this.warehouseId,
    required this.productId,
    required this.productName,
    required this.productSku,
    required this.warehouseName,
    required this.batchNumber,
    required this.supplierReference,
    required this.mfgDate,
    required this.expiryDate,
    required this.quantity,
    required this.reservedQuantity,
    required this.damagedQuantity,
    required this.unitCost,
    required this.storageBin,
    required this.qrCodeId,
    required this.status,
  });

  int get quantityRemaining => quantity;
  int get initialQuantity => quantity + 500;
  String get manufacturingDate => mfgDate;

  int get daysUntilExpiry {
    try {
      final exp = DateTime.parse(expiryDate);
      return exp.difference(DateTime.now()).inDays;
    } catch (_) {
      return 999;
    }
  }

  bool get isExpiringSoon => daysUntilExpiry <= 30;

  InventoryBatchModel copyWith({
    String? id,
    String? warehouseId,
    String? productId,
    String? productName,
    String? productSku,
    String? warehouseName,
    String? batchNumber,
    String? supplierReference,
    String? mfgDate,
    String? expiryDate,
    int? quantity,
    int? quantityRemaining,
    int? initialQuantity,
    int? reservedQuantity,
    int? damagedQuantity,
    double? unitCost,
    String? storageBin,
    String? qrCodeId,
    String? status,
    String? manufacturingDate,
  }) {
    return InventoryBatchModel(
      id: id ?? this.id,
      warehouseId: warehouseId ?? this.warehouseId,
      productId: productId ?? this.productId,
      productName: productName ?? this.productName,
      productSku: productSku ?? this.productSku,
      warehouseName: warehouseName ?? this.warehouseName,
      batchNumber: batchNumber ?? this.batchNumber,
      supplierReference: supplierReference ?? this.supplierReference,
      mfgDate: manufacturingDate ?? mfgDate ?? this.mfgDate,
      expiryDate: expiryDate ?? this.expiryDate,
      quantity: quantityRemaining ?? quantity ?? this.quantity,
      reservedQuantity: reservedQuantity ?? this.reservedQuantity,
      damagedQuantity: damagedQuantity ?? this.damagedQuantity,
      unitCost: unitCost ?? this.unitCost,
      storageBin: storageBin ?? this.storageBin,
      qrCodeId: qrCodeId ?? this.qrCodeId,
      status: status ?? this.status,
    );
  }

  factory InventoryBatchModel.fromJson(Map<String, dynamic> json) {
    return InventoryBatchModel(
      id: json['id'] ?? '',
      warehouseId: json['warehouse_id'] ?? '',
      productId: json['product_id'] ?? '',
      productName: json['product_name'] ?? 'Product',
      productSku: json['product_sku'] ?? '',
      warehouseName: json['warehouse_name'] ?? 'Warehouse',
      batchNumber: json['batch_number'] ?? '',
      supplierReference: json['supplier_reference'] ?? '',
      mfgDate: json['mfg_date'] ?? json['manufacturing_date'] ?? '',
      expiryDate: json['expiry_date'] ?? '',
      quantity: json['quantity'] ?? json['quantity_remaining'] ?? 0,
      reservedQuantity: json['reserved_quantity'] ?? 0,
      damagedQuantity: json['damaged_quantity'] ?? 0,
      unitCost: (json['unit_cost'] as num?)?.toDouble() ?? 0.0,
      storageBin: json['storage_bin'] ?? '',
      qrCodeId: json['qr_code_id'] ?? '',
      status: json['status'] ?? 'active',
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'warehouse_id': warehouseId,
      'product_id': productId,
      'product_name': productName,
      'product_sku': productSku,
      'warehouse_name': warehouseName,
      'batch_number': batchNumber,
      'supplier_reference': supplierReference,
      'mfg_date': mfgDate,
      'expiry_date': expiryDate,
      'quantity': quantity,
      'reserved_quantity': reservedQuantity,
      'damaged_quantity': damagedQuantity,
      'unit_cost': unitCost,
      'storage_bin': storageBin,
      'qr_code_id': qrCodeId,
      'status': status,
    };
  }
}
