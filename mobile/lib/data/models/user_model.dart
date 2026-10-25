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
        return UserRole.operator;
      default:
        throw FormatException('Unrecognized or invalid user role: $role');
    }
  }

  static UserRole? tryFromString(String? role) {
    if (role == null) return null;
    try {
      return fromString(role);
    } catch (_) {
      return null;
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
  final List<String> warehouseIds;
  final String? warehouseNameVal;
  final String? phoneNumber;
  final bool isActive;
  final List<String> permissions;

  UserModel({
    required this.id,
    required this.email,
    required this.fullName,
    required this.role,
    required this.orgId,
    this.warehouseId,
    this.warehouseIds = const [],
    this.warehouseNameVal,
    this.phoneNumber,
    this.isActive = true,
    this.permissions = const [],
  });

  String get name => fullName.isNotEmpty ? fullName : email.split('@').first;
  String get organizationId => orgId;

  String get warehouseName {
    if (warehouseNameVal != null && warehouseNameVal!.isNotEmpty) {
      return warehouseNameVal!;
    }
    if (warehouseId != null && warehouseId!.isNotEmpty) {
      return 'Facility ($warehouseId)';
    }
    if (role == UserRole.superAdmin || role == UserRole.orgAdmin || role == UserRole.supplyChainManager) {
      return 'Network-Wide / Multi-Hub Scope';
    }
    if (role == UserRole.distributor) {
      return 'Fleet Logistics & Distribution Hub';
    }
    return 'Unassigned Facility';
  }

  bool hasPermission(String perm) {
    if (role == UserRole.superAdmin) return true;
    return permissions.contains(perm);
  }

  bool get canApproveTransfers =>
      role == UserRole.superAdmin ||
      role == UserRole.orgAdmin ||
      role == UserRole.supplyChainManager ||
      role == UserRole.warehouseManager ||
      hasPermission('transfers:approve');

  bool get canMutateInventory =>
      role != UserRole.distributor &&
      (role == UserRole.operator ||
          role == UserRole.warehouseManager ||
          role == UserRole.orgAdmin ||
          role == UserRole.superAdmin ||
          hasPermission('inventory:receive') ||
          hasPermission('inventory:dispatch'));

  bool get canAccessIot =>
      role == UserRole.superAdmin ||
      role == UserRole.orgAdmin ||
      role == UserRole.supplyChainManager ||
      role == UserRole.warehouseManager ||
      hasPermission('alerts:manage');

  bool get canAccessTasks => role != UserRole.distributor;

  bool get hasNetworkWideScope =>
      role == UserRole.superAdmin ||
      role == UserRole.orgAdmin ||
      role == UserRole.supplyChainManager;

  bool get isExecutiveOrAdmin => hasNetworkWideScope;

  bool canAccessWarehouse(String? whId) {
    if (hasNetworkWideScope) {
      return true;
    }
    if (whId == null || whId.isEmpty) return false;
    return warehouseId == whId || warehouseIds.contains(whId);
  }

  factory UserModel.fromJson(Map<String, dynamic> json) {
    final rawRole = json['role']?.toString();
    if (rawRole == null || rawRole.isEmpty) {
      throw const FormatException('Missing or null user role in backend response.');
    }
    final parsedRole = UserRole.fromString(rawRole);

    final rawPerms = json['permissions'];
    final permsList = <String>[];
    if (rawPerms is List) {
      for (final p in rawPerms) {
        if (p != null) permsList.add(p.toString());
      }
    }

    final rawWhIds = json['warehouse_ids'] ?? json['warehouseIds'];
    final whList = <String>[];
    if (rawWhIds is List) {
      for (final w in rawWhIds) {
        if (w != null) whList.add(w.toString());
      }
    }
    final primaryWh = json['warehouse_id'] ?? json['warehouseId'];
    if (primaryWh != null && !whList.contains(primaryWh.toString())) {
      whList.add(primaryWh.toString());
    }

    return UserModel(
      id: json['id'] ?? '',
      email: json['email'] ?? '',
      fullName: json['full_name'] ?? json['fullName'] ?? json['name'] ?? '',
      role: parsedRole,
      orgId: json['org_id'] ?? json['orgId'] ?? json['organization_id'] ?? 'org_triwiz_01',
      warehouseId: primaryWh?.toString(),
      warehouseIds: whList,
      warehouseNameVal: json['warehouse_name'] ?? json['warehouseName'],
      phoneNumber: json['phone_number'] ?? json['phoneNumber'],
      isActive: json['is_active'] ?? true,
      permissions: permsList,
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
      'warehouse_ids': warehouseIds,
      'warehouse_name': warehouseNameVal,
      'phone_number': phoneNumber,
      'is_active': isActive,
      'permissions': permissions,
    };
  }
}
