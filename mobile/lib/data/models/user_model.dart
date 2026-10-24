enum UserRole {
  superAdmin,
  orgAdmin,
  supplyChainManager,
  warehouseManager,
  distributor,
  operator;

  static const UserRole warehouseOperator = UserRole.operator;
  static const UserRole distributorFieldOperator = UserRole.distributor;

  static UserRole fromString(String role) {
    final r = role.toLowerCase().replaceAll(' ', '_');
    switch (r) {
      case 'super_admin':
        return UserRole.superAdmin;
      case 'org_admin':
      case 'organization_admin':
        return UserRole.orgAdmin;
      case 'supply_chain_manager':
        return UserRole.supplyChainManager;
      case 'warehouse_manager':
        return UserRole.warehouseManager;
      case 'distributor':
      case 'distributor_field_operator':
        return UserRole.distributor;
      case 'operator':
      case 'warehouse_operator':
      default:
        return UserRole.operator;
    }
  }

  String get displayName {
    switch (this) {
      case UserRole.superAdmin:
        return 'Super Admin';
      case UserRole.orgAdmin:
        return 'Organization Admin';
      case UserRole.supplyChainManager:
        return 'Supply Chain Manager';
      case UserRole.warehouseManager:
        return 'Warehouse Manager';
      case UserRole.distributor:
        return 'Distributor / Field Operator';
      case UserRole.operator:
        return 'Warehouse Operator';
    }
  }

  String get apiValue {
    switch (this) {
      case UserRole.superAdmin:
        return 'super_admin';
      case UserRole.orgAdmin:
        return 'org_admin';
      case UserRole.supplyChainManager:
        return 'supply_chain_manager';
      case UserRole.warehouseManager:
        return 'warehouse_manager';
      case UserRole.distributor:
        return 'distributor';
      case UserRole.operator:
        return 'operator';
    }
  }

  bool get isManagerOrAbove =>
      this == UserRole.superAdmin ||
      this == UserRole.orgAdmin ||
      this == UserRole.supplyChainManager ||
      this == UserRole.warehouseManager;
}

class UserModel {
  final String id;
  final String email;
  final String fullName;
  final UserRole role;
  final String orgId;
  final String? warehouseId;
  final String? warehouseNameVal;
  final String? phoneNumber;
  final bool isActive;

  UserModel({
    required this.id,
    required this.email,
    required this.fullName,
    required this.role,
    required this.orgId,
    this.warehouseId,
    this.warehouseNameVal,
    this.phoneNumber,
    this.isActive = true,
  });

  String get name => fullName.isNotEmpty ? fullName : email.split('@').first;
  String get organizationId => orgId;
  String get warehouseName => warehouseNameVal ?? (warehouseId != null ? 'Warehouse ($warehouseId)' : 'Central Distribution Hub (Bengaluru)');

  factory UserModel.fromJson(Map<String, dynamic> json) {
    return UserModel(
      id: json['id'] ?? '',
      email: json['email'] ?? '',
      fullName: json['full_name'] ?? json['fullName'] ?? json['name'] ?? '',
      role: UserRole.fromString(json['role'] ?? 'operator'),
      orgId: json['org_id'] ?? json['orgId'] ?? json['organization_id'] ?? 'org_triwiz_01',
      warehouseId: json['warehouse_id'] ?? json['warehouseId'],
      warehouseNameVal: json['warehouse_name'] ?? json['warehouseName'],
      phoneNumber: json['phone_number'] ?? json['phoneNumber'],
      isActive: json['is_active'] ?? true,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'email': email,
      'full_name': fullName,
      'role': role.apiValue,
      'org_id': orgId,
      'warehouse_id': warehouseId,
      'warehouse_name': warehouseNameVal,
      'phone_number': phoneNumber,
      'is_active': isActive,
    };
  }
}
