import 'package:dio/dio.dart';
import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio_cookie_manager/dio_cookie_manager.dart';
import 'package:path_provider/path_provider.dart';

class ApiClient {
  static String _baseUrl = 'http://localhost:3000';
  static Dio? dioForNotification;
  late final Dio dio;
  late final CookieJar _cookieJar;

  ApiClient({String? baseUrl}) {
    _baseUrl = baseUrl ?? _baseUrl;
    dio = Dio(BaseOptions(
      baseUrl: _baseUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 15),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    ));
    dioForNotification = dio;
    _initCookies();
  }

  Future<void> _initCookies() async {
    final dir = await getApplicationDocumentsDirectory();
    _cookieJar = PersistCookieJar(
      storage: FileStorage('${dir.path}/.cookies'),
    );
    dio.interceptors.add(CookieManager(_cookieJar));
    dio.interceptors.add(InterceptorsWrapper(
      onError: (error, handler) {
        handler.next(error);
      },
    ));
  }

  static void setBaseUrl(String url) {
    _baseUrl = url;
  }

  static String get baseUrl => _baseUrl;

  Future<Response> get(String path, {Map<String, dynamic>? queryParameters}) {
    return dio.get(path, queryParameters: queryParameters);
  }

  Future<Response> post(String path, {dynamic data}) {
    return dio.post(path, data: data);
  }

  Future<Response> patch(String path, {dynamic data}) {
    return dio.patch(path, data: data);
  }

  Future<Response> delete(String path) {
    return dio.delete(path);
  }

  Future<void> clearCookies() async {
    await _cookieJar.deleteAll();
  }

  static String getErrorMessage(Object error, {bool includeDetails = false}) {
    if (error is DioException) {
      switch (error.type) {
        case DioExceptionType.connectionTimeout:
          return 'Koneksi timeout. Periksa koneksi internet Anda.';
        case DioExceptionType.sendTimeout:
          return 'Gagal mengirim data. Coba lagi.';
        case DioExceptionType.receiveTimeout:
          return 'Server tidak merespons. Coba lagi.';
        case DioExceptionType.badResponse:
          final statusCode = error.response?.statusCode;
          final errData = error.response?.data;
          if (errData is Map && errData['error'] != null) {
            return errData['error'] as String;
          }
          switch (statusCode) {
            case 400:
              return 'Permintaan tidak valid.';
            case 401:
              return 'Sesi berakhir. Silakan login kembali.';
            case 403:
              return 'Anda tidak memiliki akses.';
            case 404:
              return 'Data tidak ditemukan.';
            case 409:
              return 'Data sudah ada.';
            case 422:
              return 'Data tidak valid.';
            case 429:
              return 'Terlalu banyak permintaan. Coba lagi nanti.';
            case 500:
              return 'Terjadi kesalahan pada server.';
            case 502:
            case 503:
            case 504:
              return 'Server sedang tidak tersedia. Coba lagi nanti.';
            default:
              return 'Terjadi kesalahan. Coba lagi.';
          }
        case DioExceptionType.cancel:
          return 'Permintaan dibatalkan.';
        case DioExceptionType.connectionError:
          return 'Tidak dapat terhubung ke server. Periksa koneksi internet Anda.';
        default:
          return 'Terjadi kesalahan jaringan.';
      }
    }
    if (includeDetails) return 'Terjadi kesalahan: $error';
    return 'Terjadi kesalahan yang tidak terduga.';
  }
}
