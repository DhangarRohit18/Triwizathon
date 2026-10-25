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

  Future<void> _checkInitialAuth() async {
    final cached = _repo.getCachedUser();
    if (cached != null) {
      state = AuthState(user: cached);
      // Validate session against live backend
      final verified = await _repo.validateSession();
      if (verified != null) {
        state = AuthState(user: verified);
      } else {
        // Session invalid or expired on server
        state = const AuthState(user: null);
      }
    } else {
      // Require real user authentication - never fabricate an operator
      state = const AuthState(user: null);
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

  Future<void> signOut() async {
    await _repo.logout();
    state = const AuthState(user: null);
  }
}

final authNotifierProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  final repo = ref.watch(authRepositoryProvider);
  return AuthNotifier(repo);
});

// Alias for backwards compatibility
final authStateProvider = authNotifierProvider;
