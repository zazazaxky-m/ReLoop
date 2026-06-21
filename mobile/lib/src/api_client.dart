import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class ApiException implements Exception {
  const ApiException(this.message, this.statusCode);
  final String message;
  final int statusCode;

  @override
  String toString() => message;
}

class ApiClient {
  static const _baseUrlKey = 'api_base_url';
  static const _cookieKey = 'session_cookie';

  late SharedPreferences _prefs;
  String _baseUrl = 'http://10.0.2.2:3000';
  String? _cookie;

  String get baseUrl => _baseUrl;
  bool get hasSession => _cookie != null && _cookie!.isNotEmpty;

  Future<void> initialize() async {
    _prefs = await SharedPreferences.getInstance();
    _baseUrl = _prefs.getString(_baseUrlKey) ?? _baseUrl;
    _cookie = _prefs.getString(_cookieKey);
  }

  Future<void> setBaseUrl(String value) async {
    var normalized = value.trim();
    while (normalized.endsWith('/')) {
      normalized = normalized.substring(0, normalized.length - 1);
    }
    if (!normalized.startsWith('http://') &&
        !normalized.startsWith('https://')) {
      throw const ApiException(
        'Alamat server harus diawali http:// atau https://',
        0,
      );
    }
    _baseUrl = normalized;
    await _prefs.setString(_baseUrlKey, normalized);
  }

  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, String>? query,
  }) async => _decode(await http.get(_uri(path, query), headers: _headers()));

  Future<Map<String, dynamic>> post(
    String path, [
    Map<String, dynamic>? body,
  ]) async => _decode(
    await http.post(
      _uri(path),
      headers: _headers(json: true),
      body: jsonEncode(body ?? <String, dynamic>{}),
    ),
  );

  Future<Map<String, dynamic>> patch(
    String path,
    Map<String, dynamic> body,
  ) async => _decode(
    await http.patch(
      _uri(path),
      headers: _headers(json: true),
      body: jsonEncode(body),
    ),
  );

  Future<Map<String, dynamic>> delete(String path) async =>
      _decode(await http.delete(_uri(path), headers: _headers()));

  Future<void> clearSession() async {
    _cookie = null;
    await _prefs.remove(_cookieKey);
  }

  Uri _uri(String path, [Map<String, String>? query]) {
    final suffix = path.startsWith('/') ? path : '/$path';
    return Uri.parse('$_baseUrl$suffix').replace(queryParameters: query);
  }

  Map<String, String> _headers({bool json = false}) => {
    'Accept': 'application/json',
    if (json) 'Content-Type': 'application/json',
    'Cookie': ?_cookie,
  };

  Map<String, dynamic> _decode(http.Response response) {
    final setCookie = response.headers['set-cookie'];
    if (setCookie != null && setCookie.contains('reloop_session=')) {
      final match = RegExp(r'reloop_session=[^;]*').firstMatch(setCookie);
      if (match != null) {
        _cookie = match.group(0);
        if (_cookie == 'reloop_session=') {
          clearSession();
        } else {
          _prefs.setString(_cookieKey, _cookie!);
        }
      }
    }

    Map<String, dynamic> data = {};
    if (response.body.isNotEmpty) {
      try {
        final decoded = jsonDecode(response.body);
        data = decoded is Map<String, dynamic>
            ? decoded
            : <String, dynamic>{'data': decoded};
      } on FormatException {
        throw ApiException(
          'Server mengembalikan respons yang tidak valid.',
          response.statusCode,
        );
      }
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException(
        data['error']?.toString() ??
            'Permintaan gagal (${response.statusCode})',
        response.statusCode,
      );
    }
    return data;
  }
}
