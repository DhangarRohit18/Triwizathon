import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../../core/networking/api_client.dart';
import '../../../data/models/user_model.dart';
import '../../../data/repositories/auth_repository.dart';

final sharedPreferencesProvider = Provider<SharedPreferences>((ref) {
  throw UnimplementedError('SharedPreferences must be initialized and overridden before runApp');
});

final apiClientProvider = Provider<ApiClient>((ref) {
  final prefs = ref.watch(sharedPreferencesProvider);
  return ApiClient(prefs: prefs);
});

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  final prefs = ref.watch(sharedPreferencesProvider);
  return AuthRepository(apiClient: apiClient, prefs: prefs);
});

class AuthState {
  final UserModel? user;
  final bool isLoading;
  final String? error;

  const AuthState({this.user, this.isLoading = false, this.error});

  UserModel? get value => user;
  bool get isAuthenticated => user != null;
}

class AuthNotifier extends StateNotifier<AuthState> {
  final AuthRepository _repo;

  AuthNotifier(this._repo) : super(const AuthState(isLoading: true)) {
    _checkInitialAuth();
  }

  void _checkInitialAuth() {
    final cached = _repo.getCachedUser();
    if (cached != null) {
      state = AuthState(user: cached);
    } else {
      // Default to demo operator persona for zero-friction evaluation
      state = AuthState(
        user: UserModel(
          id: 'usr_operator',
          email: 'operator@stockpilot.ai',
          fullName: "James O'Connor",
          role: UserRole.operator,
          orgId: 'org_triwiz_01',
          warehouseId: 'WH-CENTRAL-01',
          warehouseNameVal: 'Central Distribution Hub (Bengaluru)',
        ),
      );
    }
  }

  Future<void> login(String email, String password) async {
    state = const AuthState(isLoading: true);
    try {
      final user = await _repo.login(email: email, password: password);
      state = AuthState(user: user);
    } catch (e) {
      state = AuthState(error: e.toString());
      rethrow;
    }
  }

  Future<void> switchRole(UserRole newRole) async {
    await _repo.switchRole(newRole);
    final current = state.user;
    if (current != null) {
      String name = current.fullName;
      if (newRole == UserRole.operator) name = "James O'Connor";
      if (newRole == UserRole.warehouseManager) name = "David Sterling";
      if (newRole == UserRole.supplyChainManager) name = "Elena Rostova";
      if (newRole == UserRole.distributor) name = "Rajiv Patel";
      if (newRole == UserRole.orgAdmin) name = "Marcus Vance";

      state = AuthState(
        user: UserModel(
          id: current.id,
          email: current.email,
          fullName: name,
          role: newRole,
          orgId: current.orgId,
          warehouseId: newRole == UserRole.operator || newRole == UserRole.warehouseManager ? 'WH-CENTRAL-01' : null,
          warehouseNameVal: newRole == UserRole.operator || newRole == UserRole.warehouseManager ? 'Central Distribution Hub (Bengaluru)' : null,
        ),
      );
    }
  }

  Future<void> signOut() async {
    await _repo.logout();
    state = const AuthState(user: null);
  }

  Future<void> logout() => signOut();
}

final authNotifierProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  final repo = ref.watch(authRepositoryProvider);
  return AuthNotifier(repo);
});

final authStateProvider = authNotifierProvider;
