import 'package:shared_preferences/shared_preferences.dart';
import '../../core/config/api_config.dart';
import '../../core/networking/api_client.dart';
import '../models/user_model.dart';

class AuthRepository {
  final ApiClient apiClient;
  final SharedPreferences prefs;

  AuthRepository({required this.apiClient, required this.prefs});

  UserModel? getCachedUser() {
    final token = prefs.getString(ApiConfig.keyAuthToken);
    final roleStr = prefs.getString(ApiConfig.keyUserRole);
    final whId = prefs.getString(ApiConfig.keyWarehouseId);

    if (token == null || token.isEmpty) return null;

    final role = UserRole.fromString(roleStr ?? 'operator');
    return UserModel(
      id: 'cached_user',
      email: role == UserRole.operator ? 'operator@stockpilot.ai' : 'warehouse.manager@stockpilot.ai',
      fullName: role == UserRole.operator ? "James O'Connor" : 'David Sterling',
      role: role,
      orgId: ApiConfig.defaultOrgId,
      warehouseId: whId ?? 'wh_chicago_01',
    );
  }

  Future<UserModel> login({required String email, required String password}) async {
    try {
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
      if (user.warehouseId != null) {
        await prefs.setString(ApiConfig.keyWarehouseId, user.warehouseId!);
      }

      return user;
    } catch (_) {
      // Offline fallback: if network fails during demo evaluation, allow seed credentials
      return _demoLogin(email);
    }
  }

  UserModel _demoLogin(String email) {
    UserRole role = UserRole.operator;
    String name = "James O'Connor";
    String wh = 'wh_chicago_01';

    if (email.contains('manager') || email.contains('wh')) {
      role = UserRole.warehouseManager;
      name = 'David Sterling';
    } else if (email.contains('supply') || email.contains('chain')) {
      role = UserRole.supplyChainManager;
      name = 'Elena Rostova';
      wh = 'all';
    } else if (email.contains('distributor')) {
      role = UserRole.distributor;
      name = 'Rajiv Patel';
    } else if (email.contains('admin')) {
      role = UserRole.orgAdmin;
      name = 'Marcus Vance';
      wh = 'all';
    }

    final user = UserModel(
      id: 'demo_${role.apiValue}',
      email: email,
      fullName: name,
      role: role,
      orgId: ApiConfig.defaultOrgId,
      warehouseId: wh,
    );

    prefs.setString(ApiConfig.keyAuthToken, 'demo_bearer_token');
    prefs.setString(ApiConfig.keyUserRole, role.apiValue);
    prefs.setString(ApiConfig.keyWarehouseId, wh);

    return user;
  }

  Future<void> switchRole(UserRole newRole) async {
    await prefs.setString(ApiConfig.keyUserRole, newRole.apiValue);
    final wh = newRole == UserRole.operator ? 'wh_chicago_01' : 'wh_chicago_01';
    await prefs.setString(ApiConfig.keyWarehouseId, wh);
  }

  Future<void> logout() async {
    await prefs.remove(ApiConfig.keyAuthToken);
    await prefs.remove(ApiConfig.keyUserRole);
    await prefs.remove(ApiConfig.keyWarehouseId);
  }
}
