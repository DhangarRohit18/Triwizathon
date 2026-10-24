import 'package:dio/dio.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../config/api_config.dart';
import '../errors/app_exception.dart';

class ApiClient {
  late final Dio dio;
  final SharedPreferences prefs;

  ApiClient({required this.prefs}) {
    final customUrl = prefs.getString(ApiConfig.keyCustomBaseUrl);
    final baseUrl = (customUrl != null && customUrl.isNotEmpty) ? customUrl : ApiConfig.defaultBaseUrl;

    dio = Dio(
      BaseOptions(
        baseUrl: baseUrl,
        connectTimeout: ApiConfig.connectTimeout,
        receiveTimeout: ApiConfig.receiveTimeout,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      ),
    );

    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          final token = prefs.getString(ApiConfig.keyAuthToken);
          if (token != null && token.isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          return handler.next(options);
        },
        onError: (DioException e, handler) {
          final appEx = _mapDioError(e);
          return handler.reject(
            DioException(
              requestOptions: e.requestOptions,
              error: appEx,
              response: e.response,
              type: e.type,
            ),
          );
        },
      ),
    );
  }

  void updateBaseUrl(String newUrl) {
    dio.options.baseUrl = newUrl;
    prefs.setString(ApiConfig.keyCustomBaseUrl, newUrl);
  }

  Future<Response<T>> get<T>(
    String path, {
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    try {
      return await dio.get<T>(path, queryParameters: queryParameters, options: options);
    } on DioException catch (e) {
      throw e.error as AppException;
    }
  }

  Future<Response<T>> post<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    try {
      return await dio.post<T>(path, data: data, queryParameters: queryParameters, options: options);
    } on DioException catch (e) {
      throw e.error as AppException;
    }
  }

  AppException _mapDioError(DioException error) {
    if (error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.receiveTimeout ||
        error.type == DioExceptionType.sendTimeout ||
        error.type == DioExceptionType.connectionError) {
      return NetworkException('Unable to reach StockPilot server. Check network connection or backend host.');
    }

    final response = error.response;
    if (response != null) {
      final statusCode = response.statusCode;
      final data = response.data;
      String message = 'An unexpected server error occurred ($statusCode)';

      if (data is Map && data.containsKey('detail')) {
        message = data['detail'].toString();
      }

      if (statusCode == 401) {
        return AuthException(message);
      } else if (statusCode == 403) {
        return PermissionDeniedException(message);
      } else if (statusCode == 400 || statusCode == 422 || statusCode == 409) {
        return ValidationException(message);
      } else if (statusCode != null && statusCode >= 500) {
        return ServerException(message);
      }
    }

    return AppException(error.message ?? 'Unknown request error');
  }
}
