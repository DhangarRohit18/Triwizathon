class AllocationRecommendationModel {
  final String id;
  final String productId;
  final String productSku;
  final String productName;
  final String sourceWarehouseId;
  final String sourceWarehouseName;
  final String destinationId;
  final String destinationName;
  final int allocatedQuantity;
  final int requestedDemand;
  final double unitTransportCost;
  final double totalTransportCost;
  final double estimatedDeliveryHours;
  final double expiryRiskScore;
  final double stockoutRiskAfter;
  final String rationale;
  final bool transferred;
  final String? transferId;

  AllocationRecommendationModel({
    required this.id,
    required this.productId,
    required this.productSku,
    required this.productName,
    required this.sourceWarehouseId,
    required this.sourceWarehouseName,
    required this.destinationId,
    required this.destinationName,
    required this.allocatedQuantity,
    required this.requestedDemand,
    required this.unitTransportCost,
    required this.totalTransportCost,
    required this.estimatedDeliveryHours,
    required this.expiryRiskScore,
    required this.stockoutRiskAfter,
    required this.rationale,
    this.transferred = false,
    this.transferId,
  });

  int get recommendedQuantity => allocatedQuantity;
  String get destinationHospitalName => destinationName;
  double get estimatedTransportCost => totalTransportCost;
  double get stockoutRiskScore => stockoutRiskAfter;

  factory AllocationRecommendationModel.fromJson(Map<String, dynamic> json) {
    return AllocationRecommendationModel(
      id: json['id'] ?? '',
      productId: json['product_id'] ?? '',
      productSku: json['product_sku'] ?? '',
      productName: json['product_name'] ?? 'Product',
      sourceWarehouseId: json['source_warehouse_id'] ?? '',
      sourceWarehouseName: json['source_warehouse_name'] ?? 'Source',
      destinationId: json['destination_id'] ?? '',
      destinationName: json['destination_name'] ?? 'Destination',
      allocatedQuantity: json['allocated_quantity'] ?? json['recommended_quantity'] ?? 0,
      requestedDemand: json['requested_demand'] ?? 0,
      unitTransportCost: (json['unit_transport_cost'] as num?)?.toDouble() ?? 0.0,
      totalTransportCost: (json['total_transport_cost'] as num?)?.toDouble() ?? (json['estimated_transport_cost'] as num?)?.toDouble() ?? 0.0,
      estimatedDeliveryHours: (json['estimated_delivery_hours'] as num?)?.toDouble() ?? 0.0,
      expiryRiskScore: (json['expiry_risk_score'] as num?)?.toDouble() ?? 0.0,
      stockoutRiskAfter: (json['stockout_risk_after'] as num?)?.toDouble() ?? (json['stockout_risk_score'] as num?)?.toDouble() ?? 0.0,
      rationale: json['rationale'] ?? '',
      transferred: json['transferred'] == true,
      transferId: json['transfer_id'],
    );
  }
}
