import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:dio/dio.dart';

Widget wrapWithMaterial(Widget child) {
  return MaterialApp(
    home: Scaffold(body: child),
  );
}

class MockHttpClientAdapter implements HttpClientAdapter {
  final int statusCode;
  final dynamic responseData;

  MockHttpClientAdapter({this.statusCode = 200, this.responseData});

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? requestStream,
    Future? cancelFuture,
  ) async {
    final body = responseData is String
        ? responseData
        : responseData?.toString() ?? '';
    return ResponseBody.fromString(
      body,
      statusCode,
      headers: {
        'content-type': ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
