import 'package:shared_preferences/shared_preferences.dart';
import '../../core/config/api_config.dart';
import '../../core/networking/api_client.dart';
import '../models/user_model.dart';

class AuthRepository {
  final ApiClient apiClient;
  final SharedPreferences prefs;

  AuthRepository({required this.apiClient, required this.prefs});

  /// Restores cached authenticated user identity, or null if no session.
  UserModel? getCachedUser() {
    final token = prefs.getString(ApiConfig.keyAuthToken);
    if (token == null || token.isEmpty || token == 'demo_bearer_token') {
      return null;
    }

    final roleStr = prefs.getString(ApiConfig.keyUserRole);
    final role = UserRole.tryFromString(roleStr);
    if (role == null) {
      return null;
    }

    final id = prefs.getString('stockpilot_user_id');
    final email = prefs.getString('stockpilot_user_email');
    if (id == null || id.isEmpty || email == null || email.isEmpty) {
      return null;
    }

    final fullName = prefs.getString('stockpilot_user_fullname') ?? '';
    final orgId = prefs.getString('stockpilot_user_org_id') ?? '';
    final whId = prefs.getString(ApiConfig.keyWarehouseId);
    final whName = prefs.getString('stockpilot_user_wh_name');
    final perms = prefs.getStringList('stockpilot_user_permissions') ?? const [];
    final whIds = prefs.getStringList('stockpilot_user_warehouse_ids') ?? (whId != null ? [whId] : const []);

    return UserModel(
      id: id,
      email: email,
      fullName: fullName,
      role: role,
      orgId: orgId,
      warehouseId: whId,
      warehouseIds: whIds,
      warehouseNameVal: whName,
      permissions: perms,
    );
  }

  /// Authenticates credentials directly against backend /auth/login.
  /// Never fabricates tokens or creates mock offline identities.
  Future<UserModel> login({required String email, required String password}) async {
    final response = await apiClient.post(
      '/auth/login',
      data: {'email': email.trim().toLowerCase(), 'password': password},
    );

    final data = response.data as Map<String, dynamic>;
    final token = data['access_token'] as String;
    final userJson = data['user'] as Map<String, dynamic>;
    final user = UserModel.fromJson(userJson);

    await prefs.setString(ApiConfig.keyAuthToken, token);
    await prefs.setString(ApiConfig.keyUserRole, user.role.apiValue);
    await prefs.setString('stockpilot_user_id', user.id);
    await prefs.setString('stockpilot_user_email', user.email);
    await prefs.setString('stockpilot_user_fullname', user.fullName);
    await prefs.setString('stockpilot_user_org_id', user.orgId);
    await prefs.setStringList('stockpilot_user_permissions', user.permissions);
    await prefs.setStringList('stockpilot_user_warehouse_ids', user.warehouseIds);

    if (user.warehouseId != null && user.warehouseId!.isNotEmpty) {
      await prefs.setString(ApiConfig.keyWarehouseId, user.warehouseId!);
    } else {
      await prefs.remove(ApiConfig.keyWarehouseId);
    }

    if (user.warehouseNameVal != null && user.warehouseNameVal!.isNotEmpty) {
      await prefs.setString('stockpilot_user_wh_name', user.warehouseNameVal!);
    } else {
      await prefs.remove('stockpilot_user_wh_name');
    }

    return user;
  }

  /// Validates cached bearer token against the live server profile endpoint.
  Future<UserModel?> validateSession() async {
    final token = prefs.getString(ApiConfig.keyAuthToken);
    if (token == null || token.isEmpty || token == 'demo_bearer_token') {
      return null;
    }

    try {
      final response = await apiClient.get('/auth/me');
      final userJson = response.data as Map<String, dynamic>;
      final user = UserModel.fromJson(userJson);

      await prefs.setString(ApiConfig.keyUserRole, user.role.apiValue);
      await prefs.setString('stockpilot_user_id', user.id);
      await prefs.setString('stockpilot_user_email', user.email);
      await prefs.setString('stockpilot_user_fullname', user.fullName);
      await prefs.setString('stockpilot_user_org_id', user.orgId);
      await prefs.setStringList('stockpilot_user_permissions', user.permissions);
      await prefs.setStringList('stockpilot_user_warehouse_ids', user.warehouseIds);

      if (user.warehouseId != null && user.warehouseId!.isNotEmpty) {
        await prefs.setString(ApiConfig.keyWarehouseId, user.warehouseId!);
      } else {
        await prefs.remove(ApiConfig.keyWarehouseId);
      }
      return user;
    } catch (_) {
      // Invalid or expired token: clear session
      await logout();
      return null;
    }
  }

  /// Clears stored authentication session and credentials.
  Future<void> logout() async {
    await prefs.remove(ApiConfig.keyAuthToken);
    await prefs.remove(ApiConfig.keyUserRole);
    await prefs.remove(ApiConfig.keyWarehouseId);
    await prefs.remove('stockpilot_user_id');
    await prefs.remove('stockpilot_user_email');
    await prefs.remove('stockpilot_user_fullname');
    await prefs.remove('stockpilot_user_org_id');
    await prefs.remove('stockpilot_user_wh_name');
    await prefs.remove('stockpilot_user_permissions');
    await prefs.remove('stockpilot_user_warehouse_ids');
  }
}
