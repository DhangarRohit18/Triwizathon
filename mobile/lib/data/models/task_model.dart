enum TaskType {
  receive,
  dispatch,
  cycleCount,
  damageReport;

  static const TaskType receiving = TaskType.receive;
  static const TaskType damage = TaskType.damageReport;

  String get title {
    switch (this) {
      case TaskType.receive:
        return 'Stock Receipt';
      case TaskType.dispatch:
        return 'Pick & Dispatch';
      case TaskType.cycleCount:
        return 'Cycle Count';
      case TaskType.damageReport:
        return 'Damage Inspection';
    }
  }
}

class WarehouseTaskModel {
  final String id;
  final TaskType type;
  final String title;
  final String description;
  final String warehouseId;
  final String? productId;
  final String? productName;
  final String? productSku;
  final int expectedQuantity;
  final String status; // pending, in_progress, completed
  final String priority; // high, medium, standard
  final String createdAt;
  final String? assignedTo;
  final String targetLocation;

  WarehouseTaskModel({
    required this.id,
    required this.type,
    required this.title,
    required this.description,
    this.warehouseId = 'WH-CENTRAL-01',
    this.productId,
    this.productName,
    this.productSku,
    this.expectedQuantity = 100,
    required this.status,
    required this.priority,
    required this.createdAt,
    this.assignedTo,
    this.targetLocation = 'Floor Bay A',
  });

  bool get isCompleted => status.toLowerCase() == 'completed';
  int get requiredQuantity => expectedQuantity;

  factory WarehouseTaskModel.fromJson(Map<String, dynamic> json) {
    TaskType t = TaskType.receive;
    final typeStr = (json['type'] ?? '').toString().toLowerCase();
    if (typeStr.contains('dispatch')) {
      t = TaskType.dispatch;
    } else if (typeStr.contains('count')) {
      t = TaskType.cycleCount;
    } else if (typeStr.contains('damage')) {
      t = TaskType.damageReport;
    }

    return WarehouseTaskModel(
      id: json['id'] ?? '',
      type: t,
      title: json['title'] ?? 'Warehouse Task',
      description: json['description'] ?? '',
      warehouseId: json['warehouse_id'] ?? 'wh_chicago_01',
      productId: json['product_id'],
      productName: json['product_name'],
      productSku: json['product_sku'],
      expectedQuantity: json['required_quantity'] ?? json['expected_quantity'] ?? 100,
      status: json['status'] ?? 'pending',
      priority: json['priority'] ?? 'standard',
      createdAt: json['created_at'] ?? '',
      assignedTo: json['assigned_to'],
      targetLocation: json['target_location'] ?? 'Storage Bay',
    );
  }
}
