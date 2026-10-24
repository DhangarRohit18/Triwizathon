class InventoryItemModel {
  final String id;
  final String warehouseId;
  final String productId;
  final String productName;
  final String productSku;
  final String handling;
  final String unit;
  final String warehouseName;
  final int totalQuantity;
  final int availableQuantity;
  final int reservedQuantity;
  final int damagedQuantity;
  final int safetyStock;
  final int reorderPoint;

  InventoryItemModel({
    required this.id,
    required this.warehouseId,
    required this.productId,
    required this.productName,
    required this.productSku,
    required this.handling,
    required this.unit,
    required this.warehouseName,
    required this.totalQuantity,
    required this.availableQuantity,
    required this.reservedQuantity,
    required this.damagedQuantity,
    required this.safetyStock,
    required this.reorderPoint,
  });

  int get quantityAvailable => availableQuantity;
  String get sku => productSku;
  String get category => handling;
  String get storageType => handling;
  bool get isLowStock => availableQuantity <= safetyStock;
  bool get isColdChain => handling.toLowerCase().contains('cold') || handling.toLowerCase().contains('freeze');

  InventoryItemModel copyWith({
    String? id,
    String? warehouseId,
    String? productId,
    String? productName,
    String? productSku,
    String? handling,
    String? unit,
    String? warehouseName,
    int? totalQuantity,
    int? availableQuantity,
    int? quantityAvailable,
    int? reservedQuantity,
    int? quantityReserved,
    int? damagedQuantity,
    int? safetyStock,
    int? reorderPoint,
    String? storageType,
    String? category,
  }) {
    return InventoryItemModel(
      id: id ?? this.id,
      warehouseId: warehouseId ?? this.warehouseId,
      productId: productId ?? this.productId,
      productName: productName ?? this.productName,
      productSku: productSku ?? this.productSku,
      handling: storageType ?? category ?? handling ?? this.handling,
      unit: unit ?? this.unit,
      warehouseName: warehouseName ?? this.warehouseName,
      totalQuantity: totalQuantity ?? this.totalQuantity,
      availableQuantity: quantityAvailable ?? availableQuantity ?? this.availableQuantity,
      reservedQuantity: quantityReserved ?? reservedQuantity ?? this.reservedQuantity,
      damagedQuantity: damagedQuantity ?? this.damagedQuantity,
      safetyStock: safetyStock ?? this.safetyStock,
      reorderPoint: reorderPoint ?? this.reorderPoint,
    );
  }

  factory InventoryItemModel.fromJson(Map<String, dynamic> json) {
    return InventoryItemModel(
      id: json['id'] ?? '',
      warehouseId: json['warehouse_id'] ?? '',
      productId: json['product_id'] ?? '',
      productName: json['product_name'] ?? 'Product',
      productSku: json['product_sku'] ?? json['sku'] ?? '',
      handling: json['handling'] ?? json['storage_type'] ?? json['category'] ?? 'ambient',
      unit: json['unit'] ?? 'units',
      warehouseName: json['warehouse_name'] ?? 'Warehouse',
      totalQuantity: json['total_quantity'] ?? 0,
      availableQuantity: json['available_quantity'] ?? json['quantity_available'] ?? 0,
      reservedQuantity: json['reserved_quantity'] ?? json['quantity_reserved'] ?? 0,
      damagedQuantity: json['damaged_quantity'] ?? 0,
      safetyStock: json['safety_stock'] ?? 50,
      reorderPoint: json['reorder_point'] ?? 100,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'warehouse_id': warehouseId,
      'product_id': productId,
      'product_name': productName,
      'product_sku': productSku,
      'handling': handling,
      'unit': unit,
      'warehouse_name': warehouseName,
      'total_quantity': totalQuantity,
      'available_quantity': availableQuantity,
      'reserved_quantity': reservedQuantity,
      'damaged_quantity': damagedQuantity,
      'safety_stock': safetyStock,
      'reorder_point': reorderPoint,
    };
  }
}
